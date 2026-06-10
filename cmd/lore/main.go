package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"lore/internal/auth"
	"lore/internal/cache"
	"lore/internal/config"
	"lore/internal/events"
	"lore/internal/httpapi"
	"lore/internal/llm"
	"lore/internal/observability"
	"lore/internal/runtime"
	"lore/internal/store"
)

func main() {
	cfg := config.Load()

	shutdownTracing, err := observability.SetupTracing(context.Background(), "lore")
	if err != nil {
		slog.Error("tracing setup failed", "err", err)
		os.Exit(1)
	}
	defer func() { _ = shutdownTracing(context.Background()) }()

	repo, err := newRepository(context.Background(), cfg)
	if err != nil {
		slog.Error("repository setup failed", "err", err)
		os.Exit(1)
	}
	engine := runtime.NewEngine(repo)
	generator := llm.NewGeneratorFromConfig(llm.ProviderConfig{
		Provider:      cfg.LLMProvider,
		Model:         cfg.LLMModel,
		OllamaBaseURL: cfg.OllamaBaseURL,
		BaseURL:       cfg.LLMBaseURL,
		APIKey:        cfg.LLMAPIKey,
	})
	server := httpapi.NewServer(repo, engine, generator, cfg.LLMProvider, cfg.LLMModel)
	if err := configureAuth(server, cfg); err != nil {
		slog.Error("jwt configuration failed", "err", err)
		os.Exit(1)
	}
	if err := configureMetrics(server, cfg); err != nil {
		slog.Error("metrics configuration failed", "err", err)
		os.Exit(1)
	}
	if cfg.BootstrapToken != "" {
		server.EnableBootstrap(cfg.BootstrapToken)
	}
	if err := configureOIDC(server, cfg); err != nil {
		slog.Error("oidc configuration failed", "err", err)
		os.Exit(1)
	}
	if cfg.RedisURL != "" {
		redisCache, err := cache.NewRedisCache(cfg.RedisURL)
		if err != nil {
			slog.Warn("redis cache disabled", "err", err)
		} else {
			server.EnableCache(redisCache)
		}
	}
	if cfg.NATSURL != "" {
		if outbox, ok := repo.(events.OutboxStore); ok {
			go events.NewNATSPublisher(cfg.NATSURL, outbox, slog.Default()).Run(context.Background())
		}
	}

	addr := ":" + cfg.Port
	slog.Info("starting LORE headless LMS", "addr", addr, "llm_provider", cfg.LLMProvider, "llm_model", cfg.LLMModel)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func configureMetrics(server *httpapi.Server, cfg config.Config) error {
	token := strings.TrimSpace(cfg.MetricsToken)
	if isProductionLike(cfg.Environment) && len(token) < 32 {
		return fmt.Errorf("LORE_METRICS_TOKEN must be at least 32 bytes when LORE_ENV=%s", cfg.Environment)
	}
	if token != "" {
		server.EnableMetricsToken(token)
	}
	return nil
}

func configureAuth(server *httpapi.Server, cfg config.Config) error {
	prodLike := isProductionLike(cfg.Environment)
	switch strings.ToUpper(strings.TrimSpace(cfg.JWTAlgorithm)) {
	case "", "HS256":
		secret := strings.TrimSpace(cfg.JWTSecret)
		if prodLike && len(secret) < 32 {
			return fmt.Errorf("JWT_SECRET must be at least 32 bytes when LORE_ENV=%s", cfg.Environment)
		}
		if secret != "" {
			server.EnableJWT(secret)
		}
		return nil
	case "RS256":
		if cfg.JWTPublicKey == "" && cfg.JWTPrivateKey == "" {
			return fmt.Errorf("JWT_ALG=RS256 requires JWT_PUBLIC_KEY and/or JWT_PRIVATE_KEY")
		}
		svc, err := auth.NewRS256TokenServiceFromPEM([]byte(cfg.JWTPrivateKey), []byte(cfg.JWTPublicKey))
		if err != nil {
			return err
		}
		server.EnableJWTService(svc)
		return nil
	default:
		return fmt.Errorf("unsupported JWT_ALG %q (use HS256 or RS256)", cfg.JWTAlgorithm)
	}
}

// configureOIDC (B-20): accept externally-issued OIDC tokens when an issuer
// and audience are configured. Discovery/JWKS are lazy and rotate on unknown
// kid.
func configureOIDC(server *httpapi.Server, cfg config.Config) error {
	issuer := strings.TrimSpace(cfg.OIDCIssuer)
	audience := strings.TrimSpace(cfg.OIDCAudience)
	if issuer == "" && audience == "" {
		return nil
	}
	if issuer == "" || audience == "" {
		return fmt.Errorf("OIDC_ISSUER and OIDC_AUDIENCE must both be set to enable OIDC")
	}
	server.EnableOIDC(auth.NewOIDCVerifier(issuer, audience))
	return nil
}

func isProductionLike(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "", "dev", "development", "local", "test":
		return false
	default:
		return true
	}
}

func newRepository(ctx context.Context, cfg config.Config) (httpapi.Repository, error) {
	switch cfg.StoreDriver {
	case "", "memory":
		return store.NewMemoryStore(), nil
	case "postgres":
		if cfg.DatabaseURL == "" {
			return nil, fmt.Errorf("DATABASE_URL is required when STORE_DRIVER=postgres")
		}
		repo, err := store.NewPostgresStore(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, err
		}
		if cfg.AutoMigrate {
			if cfg.MigrationPath == "" {
				repo.Close()
				return nil, fmt.Errorf("LORE_MIGRATION_PATH is required when LORE_AUTO_MIGRATE=on")
			}
			if err := repo.ApplyMigrationsPath(ctx, cfg.MigrationPath); err != nil {
				repo.Close()
				return nil, err
			}
		}
		return repo, nil
	default:
		return nil, fmt.Errorf("unsupported STORE_DRIVER %q", cfg.StoreDriver)
	}
}
