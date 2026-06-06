package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"lore/internal/core"
)

func TestOpenAIProviderUsesChatCompletionContract(t *testing.T) {
	var gotPath, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != "model-a" || len(req.Messages) != 1 || req.Messages[0].Content == "" {
			t.Fatalf("unexpected request: %+v", req)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "model-a",
			"choices": []map[string]any{{
				"message": map[string]string{"content": "generated content"},
			}},
		})
	}))
	defer server.Close()

	content, err := OpenAIGenerator{BaseURL: server.URL, APIKey: "key", Model: "model-a"}.Generate(context.Background(), instructionFixture())
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if gotPath != "/v1/chat/completions" || gotAuth != "Bearer key" {
		t.Fatalf("unexpected request path/auth: %s %s", gotPath, gotAuth)
	}
	if content.Provider != "openai" || content.Content != "generated content" || content.Model != "model-a" {
		t.Fatalf("unexpected content: %+v", content)
	}
}

func TestAnthropicProviderUsesMessagesContract(t *testing.T) {
	var version, apiKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		version = r.Header.Get("anthropic-version")
		apiKey = r.Header.Get("x-api-key")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "claude-test",
			"content": []map[string]string{{"text": "anthropic content"}},
		})
	}))
	defer server.Close()

	content, err := AnthropicGenerator{BaseURL: server.URL, APIKey: "secret", Model: "claude-test"}.Generate(context.Background(), instructionFixture())
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if version == "" || apiKey != "secret" {
		t.Fatalf("missing anthropic headers: version=%q apiKey=%q", version, apiKey)
	}
	if content.Provider != "anthropic" || content.Content != "anthropic content" {
		t.Fatalf("unexpected content: %+v", content)
	}
}

func TestGeminiProviderUsesGenerateContentContract(t *testing.T) {
	var gotPath, gotKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.URL.Query().Get("key")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{{
				"content": map[string]any{"parts": []map[string]string{{"text": "gemini content"}}},
			}},
		})
	}))
	defer server.Close()

	content, err := GeminiGenerator{BaseURL: server.URL, APIKey: "gemini-key", Model: "gemini-test"}.Generate(context.Background(), instructionFixture())
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if gotPath != "/v1beta/models/gemini-test:generateContent" || gotKey != "gemini-key" {
		t.Fatalf("unexpected gemini request: path=%s key=%s", gotPath, gotKey)
	}
	if content.Provider != "gemini" || content.Content != "gemini content" {
		t.Fatalf("unexpected content: %+v", content)
	}
}

func TestCustomProviderAndFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"content": "custom content", "model": "custom-model"})
	}))
	defer server.Close()

	content, err := CustomGenerator{BaseURL: server.URL, APIKey: "key", Model: "custom-model"}.Generate(context.Background(), instructionFixture())
	if err != nil {
		t.Fatalf("custom generate: %v", err)
	}
	if content.Provider != "custom" || content.Content != "custom content" {
		t.Fatalf("unexpected custom content: %+v", content)
	}

	fallback := NewGeneratorFromConfig(ProviderConfig{Provider: "openai", BaseURL: "http://127.0.0.1:1", APIKey: "bad"})
	fallbackContent, err := fallback.Generate(context.Background(), instructionFixture())
	if err != nil {
		t.Fatalf("fallback generate: %v", err)
	}
	if fallbackContent.Provider != "instruction_only" {
		t.Fatalf("expected instruction fallback, got %+v", fallbackContent)
	}
}

func instructionFixture() core.TutorInstruction {
	return core.TutorInstruction{
		ID:               "instruction-1",
		TenantID:         "tenant-1",
		LearnerID:        "learner-1",
		DomainID:         "domain-1",
		ConceptID:        "concept-1",
		ActivityID:       "activity-1",
		ActivityType:     core.ActivityExplanation,
		DifficultyTarget: 0.4,
		Constraints:      []string{"runtime decides progression"},
		Context:          map[string]any{"concept": "HTTP"},
	}
}
