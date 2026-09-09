import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModelInfo } from "../../../ipc/types";

import { useTranslation } from "../../../i18n/useTranslation";
import { llmListModels } from "../../../ipc/invoke";
import { type AIProvider, useAIStore } from "../../../stores/ai/ai";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "../../../stores/ai/providers";
import { formatAIError } from "../../../utils/format-error";
import { CustomAICommandEditor } from "../CustomAICommandEditor";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";

// ─── Task Model Selector ────────────────────────────────

export function AITab() {
  const { t } = useTranslation();
  const {
    provider,
    setProvider,
    model,
    setModel,
    setApiKey,
    ollamaUrl,
    setOllamaUrl,
    privacyMode,
    setPrivacyMode,
    ghostTextEnabled,
    setGhostTextEnabled,
    ghostTextDebounceMs,
    setGhostTextDebounceMs,
    maxSuggestionLength,
    setMaxSuggestionLength,
    keychainReady,
    autoModelEnabled,
    setAutoModelEnabled,
    modelForGhostText,
    modelForInlineEdit,
    modelForChat,
    modelForAgent,
    setModelForTask,
    configured,
    providerForGhostText,
    providerForInlineEdit,
    providerForChat,
    providerForAgent,
    setProviderForTask,
  } = useAIStore();
  const [showKey, setShowKey] = useState(false);
  // §259 — write-only draft. The stored secret is never loaded back into the
  // frontend, so this input only ever holds a key the user types this session.
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<null | string>(null);
  const [customMode, setCustomMode] = useState(false);

  // Model cache for task-specific selectors (avoids redundant API calls)
  const modelCacheRef = useRef<Record<string, ModelInfo[]>>({});

  const fetchModelsForProvider = useCallback(
    async (prov: AIProvider): Promise<ModelInfo[]> => {
      if (modelCacheRef.current[prov]) return modelCacheRef.current[prov];
      try {
        const baseUrl = prov === "ollama" ? ollamaUrl || undefined : undefined;
        const result = await llmListModels(prov, baseUrl);
        modelCacheRef.current[prov] = result;
        return result;
      } catch {
        return [];
      }
    },
    [ollamaUrl],
  );

  // Keyless providers are always available; the rest appear once a key is
  // stored. Derived from the provider table so a new provider cannot be
  // configured and still be missing from the task selectors.
  const configuredProviders = useMemo(
    (): AIProvider[] =>
      AI_PROVIDER_IDS.filter(
        (id) => AI_PROVIDERS[id].keyless || configured[id],
      ),
    [configured],
  );

  const handleProviderChange = useCallback(
    (newProvider: AIProvider) => {
      // `setProvider` picks the new provider's default model and drops the
      // per-task models that followed the old one; this handler only resets
      // what is local to the tab.
      setProvider(newProvider);
      setModels([]);
      setModelsError(null);
      setCustomMode(false);
      setDraft("");
    },
    [setProvider],
  );

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const baseUrl =
        provider === "ollama" ? ollamaUrl || undefined : undefined;
      const result = await llmListModels(provider, baseUrl);
      setModels(result);
      setCustomMode(false);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [provider, ollamaUrl]);

  const providerConfigured = AI_PROVIDERS[provider].keyless
    ? true
    : (configured[provider] ?? false);
  const canFetchModels = providerConfigured || draft.length > 0;
  const showApiKey = !AI_PROVIDERS[provider].keyless;
  // §259 — when a key is already stored we show a masked marker (locale-neutral)
  // rather than the secret, since the frontend never receives it.
  const keyPlaceholder =
    providerConfigured && !draft
      ? "••••••••••••••••"
      : keychainReady
        ? t("settings.ai.apiKey.placeholder")
        : t("settings.ai.apiKey.loading");

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.ai.provider")} />

      <SettingsRow
        description={t("settings.ai.aiProvider.desc")}
        label={t("settings.ai.aiProvider")}
      >
        <select
          className="settings-select"
          onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
          value={provider}
        >
          {AI_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {t(AI_PROVIDERS[id].labelKey)}
            </option>
          ))}
        </select>
      </SettingsRow>

      {showApiKey && (
        <SettingsRow
          description={
            keychainReady
              ? t("settings.ai.apiKey.desc.ready")
              : t("settings.ai.apiKey.desc.loading")
          }
          label={t("settings.ai.apiKey")}
        >
          <div className="settings-key-row">
            <input
              className="settings-input settings-input-key"
              disabled={!keychainReady}
              onChange={(e) => {
                setDraft(e.target.value);
                setApiKey(e.target.value);
              }}
              placeholder={keyPlaceholder}
              type={showKey ? "text" : "password"}
              value={draft}
            />
            <button
              className="settings-key-toggle"
              onClick={() => setShowKey((v) => !v)}
              title={
                showKey
                  ? t("settings.ai.apiKey.hide")
                  : t("settings.ai.apiKey.show")
              }
            >
              {showKey
                ? t("settings.ai.apiKey.hide")
                : t("settings.ai.apiKey.show")}
            </button>
          </div>
        </SettingsRow>
      )}

      {provider === "ollama" && (
        <SettingsRow
          description={t("settings.ai.ollamaUrl.desc")}
          label={t("settings.ai.ollamaUrl")}
        >
          <input
            className="settings-input"
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder={t("settings.ai.ollamaUrl.placeholder")}
            type="text"
            value={ollamaUrl}
          />
        </SettingsRow>
      )}

      <SettingsRow
        description={t("settings.ai.model.desc")}
        label={t("settings.ai.model")}
      >
        <div className="settings-model-row">
          {customMode || (models.length === 0 && !modelsLoading) ? (
            <input
              className="settings-input settings-input-model"
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("settings.ai.model.placeholder")}
              type="text"
              value={model}
            />
          ) : (
            <select
              className="settings-select settings-select-model"
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomMode(true);
                } else {
                  setModel(e.target.value);
                }
              }}
              value={model}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="__custom__">{t("common.custom")}...</option>
            </select>
          )}
          <button
            className="settings-model-refresh"
            disabled={!canFetchModels || modelsLoading}
            onClick={fetchModels}
            title={
              !canFetchModels
                ? t("settings.ai.model.keyFirst")
                : t("settings.ai.model.fetchTooltip")
            }
          >
            {modelsLoading ? (
              <span className="settings-model-spinner" />
            ) : (
              "\u21BB"
            )}
          </button>
        </div>
      </SettingsRow>

      {modelsError &&
        (() => {
          const formatted = formatAIError(modelsError);
          return (
            <div className="settings-model-error">
              <strong>{formatted.title}</strong>
              <span>{formatted.detail}</span>
            </div>
          );
        })()}

      <SettingsSectionHeader title={t("settings.ai.modelSelection")} />

      <SettingsRow
        description={t("settings.ai.autoModel.desc")}
        label={t("settings.ai.autoModel")}
      >
        <ToggleSwitch
          checked={autoModelEnabled}
          onChange={setAutoModelEnabled}
        />
      </SettingsRow>

      {autoModelEnabled && (
        <>
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.ghostTextModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.ghostTextModel")}
            onModelChange={(m) => setModelForTask("ghost-text", m)}
            onProviderChange={(p) => setProviderForTask("ghost-text", p)}
            taskModel={modelForGhostText}
            taskProvider={providerForGhostText}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.inlineEditModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.inlineEditModel")}
            onModelChange={(m) => setModelForTask("inline-edit", m)}
            onProviderChange={(p) => setProviderForTask("inline-edit", p)}
            taskModel={modelForInlineEdit}
            taskProvider={providerForInlineEdit}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.chatModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.chatModel")}
            onModelChange={(m) => setModelForTask("chat", m)}
            onProviderChange={(p) => setProviderForTask("chat", p)}
            taskModel={modelForChat}
            taskProvider={providerForChat}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.agentModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.agentModel")}
            onModelChange={(m) => setModelForTask("agent", m)}
            onProviderChange={(p) => setProviderForTask("agent", p)}
            taskModel={modelForAgent}
            taskProvider={providerForAgent}
          />
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.privacy")} />

      <SettingsRow
        description={t("settings.ai.privacyMode.desc")}
        label={t("settings.ai.privacyMode")}
      >
        <ToggleSwitch checked={privacyMode} onChange={setPrivacyMode} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.ai.ghostText")} />

      <SettingsRow
        description={t("settings.ai.ghostTextEnabled.desc")}
        label={t("settings.ai.ghostTextEnabled")}
      >
        <ToggleSwitch
          checked={ghostTextEnabled}
          onChange={setGhostTextEnabled}
        />
      </SettingsRow>

      {ghostTextEnabled && (
        <>
          <SettingsRow
            description={t("settings.ai.debounce.desc").replace(
              "{value}",
              String(ghostTextDebounceMs),
            )}
            label={t("settings.ai.debounce")}
          >
            <input
              className="settings-range"
              max={2000}
              min={200}
              onChange={(e) => setGhostTextDebounceMs(Number(e.target.value))}
              step={100}
              type="range"
              value={ghostTextDebounceMs}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.ai.maxLength.desc").replace(
              "{value}",
              String(maxSuggestionLength),
            )}
            label={t("settings.ai.maxLength")}
          >
            <input
              className="settings-range"
              max={500}
              min={20}
              onChange={(e) => setMaxSuggestionLength(Number(e.target.value))}
              step={10}
              type="range"
              value={maxSuggestionLength}
            />
          </SettingsRow>
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.customCommands")} />
      <CustomAICommandEditor />
    </div>
  );
}

// ─── AI Tab ─────────────────────────────────────────────

function TaskModelSelector({
  label,
  description,
  taskProvider,
  taskModel,
  onProviderChange,
  onModelChange,
  configuredProviders,
  defaultProvider,
  defaultModel,
  fetchModelsForProvider,
}: {
  configuredProviders: AIProvider[];
  defaultModel: string;
  defaultProvider: AIProvider;
  description: string;
  fetchModelsForProvider: (provider: AIProvider) => Promise<ModelInfo[]>;
  label: string;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: "" | AIProvider) => void;
  taskModel: string;
  taskProvider: "" | AIProvider;
}) {
  const { t } = useTranslation();
  const [taskModels, setTaskModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const effectiveProvider = taskProvider || defaultProvider;
  // Selecting a provider and then entering its key is the only possible order
  // for one being set up, so the fetch below runs once against a provider with
  // no key and fails. `configuredProviders` gains that provider the moment the
  // key is stored, which is the signal — and the only signal — that the failed
  // fetch is worth repeating. A boolean, not the array, so an unrelated render
  // does not turn this into a request per keystroke in the API key field.
  const providerReady = configuredProviders.includes(effectiveProvider);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchModelsForProvider(effectiveProvider).then((result) => {
      if (!cancelled) {
        setTaskModels(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, providerReady, fetchModelsForProvider]);

  return (
    <SettingsRow description={description} label={label}>
      <div className="settings-task-model-row">
        <select
          className="settings-select settings-select-task-provider"
          onChange={(e) => {
            const val = e.target.value as "" | AIProvider;
            onProviderChange(val);
            if (val) onModelChange("");
          }}
          value={taskProvider}
        >
          <option value="">
            {t("settings.ai.useDefault")} ({AI_PROVIDERS[defaultProvider].label}
            )
          </option>
          {configuredProviders.map((p) => (
            <option key={p} value={p}>
              {AI_PROVIDERS[p].label}
            </option>
          ))}
        </select>
        {loading ? (
          <span className="settings-model-spinner" />
        ) : (
          <select
            className="settings-select settings-select-task-model"
            onChange={(e) => onModelChange(e.target.value)}
            value={taskModel}
          >
            {!taskProvider && !taskModel ? (
              <option value="">{defaultModel}</option>
            ) : (
              <option value="">{t("settings.ai.selectModel")}</option>
            )}
            {taskModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </SettingsRow>
  );
}
