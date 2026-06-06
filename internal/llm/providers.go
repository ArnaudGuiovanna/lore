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

type OpenAIGenerator struct {
	BaseURL string
	APIKey  string
	Model   string
	Client  *http.Client
}

func (g OpenAIGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	url := strings.TrimRight(fallback(g.BaseURL, "https://api.openai.com"), "/") + "/v1/chat/completions"
	body := map[string]any{
		"model": fallback(g.Model, "gpt-4.1-mini"),
		"messages": []map[string]string{{
			"role":    "user",
			"content": instructionPrompt(instruction),
		}},
	}
	content, model, err := postJSON(ctx, g.Client, url, g.APIKey, body, extractChatCompletion)
	return generated(instruction, "openai", fallback(model, fallback(g.Model, "gpt-4.1-mini")), content, err)
}

type MistralGenerator struct {
	BaseURL string
	APIKey  string
	Model   string
	Client  *http.Client
}

func (g MistralGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	url := strings.TrimRight(fallback(g.BaseURL, "https://api.mistral.ai"), "/") + "/v1/chat/completions"
	body := map[string]any{
		"model": fallback(g.Model, "mistral-small-latest"),
		"messages": []map[string]string{{
			"role":    "user",
			"content": instructionPrompt(instruction),
		}},
	}
	content, model, err := postJSON(ctx, g.Client, url, g.APIKey, body, extractChatCompletion)
	return generated(instruction, "mistral", fallback(model, fallback(g.Model, "mistral-small-latest")), content, err)
}

type AnthropicGenerator struct {
	BaseURL string
	APIKey  string
	Model   string
	Client  *http.Client
}

func (g AnthropicGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	url := strings.TrimRight(fallback(g.BaseURL, "https://api.anthropic.com"), "/") + "/v1/messages"
	body := map[string]any{
		"model":      fallback(g.Model, "claude-3-5-haiku-latest"),
		"max_tokens": 1024,
		"messages": []map[string]string{{
			"role":    "user",
			"content": instructionPrompt(instruction),
		}},
	}
	content, model, err := postJSON(ctx, g.Client, url, g.APIKey, body, func(resp *http.Response) (string, string, error) {
		var decoded struct {
			Model   string `json:"model"`
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
			return "", "", err
		}
		if len(decoded.Content) == 0 {
			return "", decoded.Model, fmt.Errorf("anthropic response contained no content")
		}
		return decoded.Content[0].Text, decoded.Model, nil
	}, func(req *http.Request) {
		req.Header.Set("x-api-key", g.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	})
	return generated(instruction, "anthropic", fallback(model, fallback(g.Model, "claude-3-5-haiku-latest")), content, err)
}

type GeminiGenerator struct {
	BaseURL string
	APIKey  string
	Model   string
	Client  *http.Client
}

func (g GeminiGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	model := fallback(g.Model, "gemini-1.5-flash")
	base := strings.TrimRight(fallback(g.BaseURL, "https://generativelanguage.googleapis.com"), "/")
	url := base + "/v1beta/models/" + model + ":generateContent"
	if g.APIKey != "" {
		url += "?key=" + g.APIKey
	}
	body := map[string]any{
		"contents": []map[string]any{{
			"parts": []map[string]string{{"text": instructionPrompt(instruction)}},
		}},
	}
	content, _, err := postJSON(ctx, g.Client, url, "", body, func(resp *http.Response) (string, string, error) {
		var decoded struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
			return "", "", err
		}
		if len(decoded.Candidates) == 0 || len(decoded.Candidates[0].Content.Parts) == 0 {
			return "", "", fmt.Errorf("gemini response contained no content")
		}
		return decoded.Candidates[0].Content.Parts[0].Text, model, nil
	})
	return generated(instruction, "gemini", model, content, err)
}

type CustomGenerator struct {
	BaseURL string
	APIKey  string
	Model   string
	Client  *http.Client
}

func (g CustomGenerator) Generate(ctx context.Context, instruction core.TutorInstruction) (core.GeneratedContent, error) {
	if g.BaseURL == "" {
		return core.GeneratedContent{}, fmt.Errorf("custom LLM base URL is required")
	}
	body := map[string]any{"model": g.Model, "instruction": instruction, "prompt": instructionPrompt(instruction)}
	content, model, err := postJSON(ctx, g.Client, g.BaseURL, g.APIKey, body, func(resp *http.Response) (string, string, error) {
		var decoded struct {
			Content string `json:"content"`
			Text    string `json:"text"`
			Model   string `json:"model"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
			return "", "", err
		}
		content := decoded.Content
		if content == "" {
			content = decoded.Text
		}
		if content == "" {
			return "", decoded.Model, fmt.Errorf("custom response contained no content")
		}
		return content, decoded.Model, nil
	})
	return generated(instruction, "custom", fallback(model, g.Model), content, err)
}

type responseExtractor func(*http.Response) (content string, model string, err error)
type requestCustomizer func(*http.Request)

func postJSON(ctx context.Context, client *http.Client, url, apiKey string, body any, extract responseExtractor, customizers ...requestCustomizer) (string, string, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	data, err := json.Marshal(body)
	if err != nil {
		return "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	for _, customize := range customizers {
		customize(req)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("LLM request failed: %s", resp.Status)
	}
	return extract(resp)
}

func extractChatCompletion(resp *http.Response) (string, string, error) {
	var decoded struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", "", err
	}
	if len(decoded.Choices) == 0 || decoded.Choices[0].Message.Content == "" {
		return "", decoded.Model, fmt.Errorf("chat completion response contained no content")
	}
	return decoded.Choices[0].Message.Content, decoded.Model, nil
}

func instructionPrompt(instruction core.TutorInstruction) string {
	data, _ := json.MarshalIndent(instruction, "", "  ")
	return "Generate learner-facing content from this LORE TutorInstruction. Do not decide mastery, retention, review timing, or learner progression.\n\n" + string(data)
}

func generated(instruction core.TutorInstruction, provider, model, content string, err error) (core.GeneratedContent, error) {
	if err != nil {
		return core.GeneratedContent{}, err
	}
	return core.GeneratedContent{
		TenantID:      instruction.TenantID,
		ID:            ids.New(),
		InstructionID: instruction.ID,
		Provider:      provider,
		Model:         model,
		Content:       content,
		CreatedAt:     time.Now().UTC(),
	}, nil
}
