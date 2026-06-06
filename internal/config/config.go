package config

import (
	"os"
	"strings"
)

type Config struct {
	Port          string
	StoreDriver   string
	DatabaseURL   string
	AutoMigrate   bool
	MigrationPath string
	RedisURL      string
	NATSURL       string
	JWTSecret     string
	LLMProvider   string
	LLMModel      string
	OllamaBaseURL string
	LLMBaseURL    string
	LLMAPIKey     string
}

func Load() Config {
	cfg := Config{
		Port:          getenv("PORT", "8080"),
		StoreDriver:   getenv("STORE_DRIVER", "memory"),
		DatabaseURL:   getenv("DATABASE_URL", ""),
		AutoMigrate:   boolenv("LORE_AUTO_MIGRATE", false),
		MigrationPath: getenv("LORE_MIGRATION_PATH", ""),
		RedisURL:      getenv("REDIS_URL", ""),
		NATSURL:       getenv("NATS_URL", ""),
		JWTSecret:     getenv("JWT_SECRET", ""),
		LLMProvider:   getenv("LORE_LLM_PROVIDER", "ollama"),
		LLMModel:      getenv("LORE_LLM_MODEL", "gemma4"),
		OllamaBaseURL: getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
		LLMBaseURL:    getenv("LORE_LLM_BASE_URL", ""),
		LLMAPIKey:     getenv("LORE_LLM_API_KEY", ""),
	}
	return cfg
}

func getenv(name, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	return value
}

func boolenv(name string, fallback bool) bool {
	value := strings.ToLower(os.Getenv(name))
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
