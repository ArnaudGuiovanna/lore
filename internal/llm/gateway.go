package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"lore/internal/core"
	"lore/internal/ids"
)

type Generator interface {
	Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error)
}

type ProviderConfig struct {
	Provider      string
	Model         string
	OllamaBaseURL string
	BaseURL       string
	APIKey        string
	Temperature   float64
	MaxTokens     int
	Client        *http.Client
}

type InstructionOnlyGenerator struct {
	Provider string
	Model    string
}

func (g InstructionOnlyGenerator) Generate(_ context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	content := fmt.Sprintf(
		"Runtime instruction for %s on concept %s. Activity=%s difficulty=%.2f. Constraints: %s",
		instruction.LearnerID,
		instruction.ConceptID,
		instruction.ActivityType,
		instruction.DifficultyTarget,
		strings.Join(instruction.Constraints, " "),
	)
	return core.GeneratedContent{
		TenantID:      instruction.TenantID,
		ID:            ids.New(),
		InstructionID: instruction.ID,
		Provider:      fallback(g.Provider, "instruction_only"),
		Model:         fallback(g.Model, "runtime"),
		Content:       content,
		CreatedAt:     time.Now().UTC(),
	}, nil
}

type OllamaGenerator struct {
	BaseURL     string
	Model       string
	Temperature float64
	MaxTokens   int
	Client      *http.Client
}

func (g OllamaGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	prompt, err := json.MarshalIndent(instruction, "", "  ")
	if err != nil {
		return core.GeneratedContent{}, err
	}
	payload := map[string]any{
		"model":  fallback(g.Model, "gemma4"),
		"prompt": "Generate learner-facing content from this LORE TutorInstruction. Do not decide mastery or next steps.\n\n" + string(prompt),
		"stream": false,
	}
	options := map[string]any{}
	if g.Temperature > 0 {
		options["temperature"] = g.Temperature
	}
	if g.MaxTokens > 0 {
		options["num_predict"] = g.MaxTokens
	}
	if len(options) > 0 {
		payload["options"] = options
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return core.GeneratedContent{}, err
	}
	url := strings.TrimRight(fallback(g.BaseURL, "http://127.0.0.1:11434"), "/") + "/api/generate"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return core.GeneratedContent{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return core.GeneratedContent{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return core.GeneratedContent{}, fmt.Errorf("ollama generate failed: %s", resp.Status)
	}
	var decoded struct {
		Response string `json:"response"`
		Model    string `json:"model"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return core.GeneratedContent{}, err
	}
	return core.GeneratedContent{
		TenantID:      instruction.TenantID,
		ID:            ids.New(),
		InstructionID: instruction.ID,
		Provider:      "ollama",
		Model:         fallback(decoded.Model, fallback(g.Model, "gemma4")),
		Content:       decoded.Response,
		CreatedAt:     time.Now().UTC(),
	}, nil
}

type FallbackGenerator struct {
	Primary  Generator
	Fallback Generator
}

func (g FallbackGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	if g.Primary != nil {
		content, err := g.Primary.Generate(ctx, instruction)
		if err == nil {
			return content, nil
		}
	}
	return g.Fallback.Generate(ctx, instruction)
}

func NewGenerator(provider, model, ollamaBaseURL string) Generator {
	return NewGeneratorFromConfig(ProviderConfig{Provider: provider, Model: model, OllamaBaseURL: ollamaBaseURL})
}

func NewGeneratorFromConfig(cfg ProviderConfig) Generator {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	fallbackGen := InstructionOnlyGenerator{Provider: "instruction_only", Model: "runtime"}
	switch provider {
	case "instruction_only", "runtime":
		return InstructionOnlyGenerator{Provider: fallback(cfg.Provider, "instruction_only"), Model: fallback(cfg.Model, "runtime")}
	case "", "ollama":
		return FallbackGenerator{
			Primary:  OllamaGenerator{BaseURL: cfg.OllamaBaseURL, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client},
			Fallback: fallbackGen,
		}
	case "openai":
		return FallbackGenerator{Primary: OpenAIGenerator{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client}, Fallback: fallbackGen}
	case "mistral":
		return FallbackGenerator{Primary: MistralGenerator{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client}, Fallback: fallbackGen}
	case "anthropic":
		return FallbackGenerator{Primary: AnthropicGenerator{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client}, Fallback: fallbackGen}
	case "gemini":
		return FallbackGenerator{Primary: GeminiGenerator{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client}, Fallback: fallbackGen}
	case "custom":
		return FallbackGenerator{Primary: CustomGenerator{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Temperature: cfg.Temperature, MaxTokens: cfg.MaxTokens, Client: cfg.Client}, Fallback: fallbackGen}
	default:
		return fallbackGen
	}
}

func fallback(value, replacement string) string {
	if value == "" {
		return replacement
	}
	return value
}
