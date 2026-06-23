import { create } from 'zustand';
import { listTemplates } from '../services/api';
import { useChatStore } from './chatStore';
import { useSessionStore } from './sessionStore';
import { useSandboxStore } from './sandboxStore';
import type { AuthConfig, ExpertTemplate, TemplateItem } from '../types/api';

interface AuthState {
  config: AuthConfig | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  selectedExpert: ExpertTemplate | null;

  setConfig: (config: AuthConfig) => void;
  setAccessToken: (token: string) => void;
  login: (externalUserId: string) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  logout: () => void;
  clearError: () => void;
  setSelectedExpert: (expert: ExpertTemplate | null) => void;
  setTemplateId: (templateId: string, templateName?: string) => void;
}

const EXPERT_AVATARS = [
  'https://img.alicdn.com/imgextra/i2/6000000006913/O1CN017tneP620wD8kVZFDn_!!6000000006913-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000005580/O1CN01AVtvcn1r5hBVIkwET_!!6000000005580-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000003494/O1CN01wRFHmI1bgIzVwQs2S_!!6000000003494-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000001106/O1CN01hnqFxM1K2bBd0IzJt_!!6000000001106-2-gg_dtc.png',
];

function expertFromTemplate(template: TemplateItem, index = 0): ExpertTemplate | null {
  const id = template.TemplateId || template.TemplateKey;
  if (!id) return null;
  return {
    id,
    name: template.TemplateKey || id,
    description: template.TemplateId || undefined,
    avatar: EXPERT_AVATARS[index % EXPERT_AVATARS.length],
    status: 'online',
    templateId: template.TemplateId,
    templateKey: template.TemplateKey,
    tenantId: template.TenantId,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function requestAccessToken(externalUserId: string): Promise<string> {
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalUserId }),
  });
  const data = await res.json();
  if (!res.ok || !data.Success || !data.AccessToken) {
    throw new Error(data.Message || 'Failed to get access token');
  }
  return data.AccessToken as string;
}

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
let tokenExpiresAt = 0;
let pendingTokenRequest: Promise<string> | null = null;

const STORAGE_KEY = 'jvscrew_auth';

function persistAuth(externalUserId: string, templateId?: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ externalUserId, templateId }));
}

function clearPersistedAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  config: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  selectedExpert: null,

  setConfig: (config) => set({ config }),

  setAccessToken: (token) =>
    set({ accessToken: token, isAuthenticated: true }),

  login: async (externalUserId) => {
    set({ isLoading: true, error: null });
    try {
      const accessToken = await requestAccessToken(externalUserId);
      const payload = decodeJwtPayload(accessToken);
      if (payload && typeof payload.exp === 'number') {
        tokenExpiresAt = payload.exp * 1000;
        console.log('[Auth] token expires at:', new Date(tokenExpiresAt).toISOString(), `(${Math.round((tokenExpiresAt - Date.now()) / 1000)}s from now)`);
      } else {
        tokenExpiresAt = Date.now() + 4 * 60 * 1000;
      }

      const previousTemplateId = get().config?.templateId;
      let resolvedConfig: AuthConfig = { externalUserId };
      let selectedExpert: ExpertTemplate | null = null;

      try {
        const templates = await listTemplates();
        const selectedIndex = templates.Items.findIndex((t) => t.TemplateId === previousTemplateId);
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        const selectedTemplate = templates.Items[idx] ?? templates.Items[0];
        selectedExpert = selectedTemplate ? expertFromTemplate(selectedTemplate, idx) : null;
        if (selectedExpert) {
          resolvedConfig = {
            externalUserId,
            templateId: selectedExpert.id,
            templateName: selectedExpert.name,
          };
        }
      } catch {
        selectedExpert = null;
      }

      persistAuth(externalUserId, resolvedConfig.templateId);
      set({
        config: resolvedConfig,
        selectedExpert,
        accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refreshAccessToken: async () => {
    const current = get().config;
    if (!current) return null;

    const existing = get().accessToken;
    if (existing && Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return existing;
    }

    if (pendingTokenRequest) {
      try {
        return await pendingTokenRequest;
      } catch {
        return null;
      }
    }

    try {
      pendingTokenRequest = requestAccessToken(current.externalUserId);
      const token = await pendingTokenRequest;
      const payload = decodeJwtPayload(token);
      if (payload && typeof payload.exp === 'number') {
        tokenExpiresAt = payload.exp * 1000;
        console.log('[Auth] token refreshed, expires at:', new Date(tokenExpiresAt).toISOString(), `(${Math.round((tokenExpiresAt - Date.now()) / 1000)}s from now)`);
      } else {
        tokenExpiresAt = Date.now() + 4 * 60 * 1000;
      }

      set({
        accessToken: token,
        isAuthenticated: true,
        error: null,
      });
      return token;
    } catch (err) {
      set({
        accessToken: null,
        isAuthenticated: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      pendingTokenRequest = null;
    }
  },

  logout: () => {
    clearPersistedAuth();
    sessionStorage.clear();
    tokenExpiresAt = 0;
    useChatStore.getState().clearMessages();
    useSessionStore.getState().setSessions([]);
    useSandboxStore.getState().reset();
    set({
      config: null,
      accessToken: null,
      isAuthenticated: false,
      error: null,
      selectedExpert: null,
    });
  },

  clearError: () => set({ error: null }),

  setSelectedExpert: (expert) => {
    const current = get().config;
    const newConfig = current
      ? expert
        ? { ...current, templateId: expert.id, templateName: expert.name }
        : { externalUserId: current.externalUserId }
      : null;
    if (newConfig) {
      const templateId = 'templateId' in newConfig ? newConfig.templateId : undefined;
      persistAuth(newConfig.externalUserId, templateId);
    }
    set({ selectedExpert: expert, config: newConfig });
  },

  setTemplateId: (templateId, templateName) => {
    const current = get().config;
    if (current) {
      persistAuth(current.externalUserId, templateId);
      set({
        config: {
          ...current,
          templateId,
          templateName: templateName ?? current.templateName,
        },
      });
    }
  },
}));
