package httpapi

// B-27: permissions par capacité. Les rôles restent le support du jeton, mais
// chaque mutation sensible est exprimée en capacité — le GESTIONNAIRE couvre
// l'administratif (inscriptions, sessions, documents, financement, qualité)
// sans la configuration technique ni la responsabilité pédagogique.

import (
	"net/http"
	"strings"

	"lore/internal/auth"
	"lore/internal/core"
)

type capability string

const (
	capManageUsers       capability = "manage_users"
	capManageEnrollments capability = "manage_enrollments"
	capManageSessions    capability = "manage_sessions"
	capManageDocuments   capability = "manage_documents"
	capManageFinance     capability = "manage_finance"
	capManageLegal       capability = "manage_legal"
	capManageQuality     capability = "manage_quality"
	// capEraseData: destruction RGPD — volontairement réservée aux admins.
	capEraseData capability = "erase_data"
	// capConfigureTechnical: intégrations et configuration technique (webhooks,
	// LLM...) — réservée aux admins.
	capConfigureTechnical capability = "configure_technical"
)

// roleCan is THE capability matrix. Admins hold everything; the manager holds
// everything administrative except data erasure; trainers and learners never
// pass through here (their mutations are guarded by routes, not capabilities).
func roleCan(role string, tenantMatches bool, cap capability) bool {
	switch role {
	case string(core.RoleSuperAdmin):
		return true
	case string(core.RoleTenantAdmin):
		return tenantMatches
	case string(core.RoleManager):
		return tenantMatches && cap != capEraseData && cap != capConfigureTechnical
	default:
		return false
	}
}

// authorizeCapability mirrors authorizeAdminMutation but checks a capability
// instead of a fixed role pair.
func (s *Server) authorizeCapability(w http.ResponseWriter, r *http.Request, tenantID string, cap capability) bool {
	if s.tokens == nil {
		return true
	}
	if s.callerIsBootstrap(r) {
		return true
	}
	claims, ok := r.Context().Value(claimsContextKey{}).(auth.Claims)
	if !ok {
		var found bool
		claims, found = s.callerClaims(r)
		ok = found
	}
	if !ok {
		problem(w, http.StatusUnauthorized, "authentication is required for this operation")
		return false
	}
	if roleCan(claims.Role, claims.TenantID == tenantID, cap) {
		return true
	}
	problem(w, http.StatusForbidden, "your role does not hold the "+string(cap)+" capability")
	return false
}

// isManagerAllowedRoute: the GESTIONNAIRE reads everything in-tenant but never
// touches the pedagogical authoring surfaces nor the technical configuration.
// Fine-grained mutation rights are enforced per-handler via capabilities; this
// middleware gate only carves out the forbidden territories.
func isManagerAllowedRoute(r *http.Request) bool {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		// /v1/tenants list & co: same posture as a tenant admin (denied later
		// by the per-handler super-admin checks where relevant).
		return true
	}
	tail := parts[3:]
	// Configuration technique : interdite, lecture comprise (la config LLM
	// porte des secrets).
	if tail[0] == "llm-configurations" || tail[0] == "webhooks" {
		return false
	}
	if r.Method == http.MethodGet {
		return true
	}
	// Responsabilité pédagogique : conception des domaines, syllabus, modules,
	// banque de questions, revue de contenu et correction restent aux
	// formateurs/admins.
	switch tail[0] {
	case "domains", "syllabi", "modules", "questions", "content-review":
		return false
	}
	if tail[0] == "submissions" && len(tail) == 3 && tail[2] == "grade" {
		return false
	}
	if tail[0] == "assignments" && r.Method == http.MethodPost {
		// création de devoirs = acte pédagogique ; la remise apprenant ne passe
		// jamais par ici (rôle LEARNER).
		return false
	}
	return true
}
