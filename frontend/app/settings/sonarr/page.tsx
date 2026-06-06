"use client";

import { SonarrStatusBadge } from "@/components/sonarr-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  fetchConfigs as apiFetchConfigs,
  fetchTasks as apiFetchTasks,
  updateConfig as apiUpdateConfig,
  updateTaskInterval as apiUpdateTaskInterval,
  fetchRootFolders,
  fetchSonarrTags,
  forceSonarrHealthCheck,
  syncRootFolders,
  updateRootFolderMapping,
  type RootFolder
} from "@/lib/api";
import { debounce } from "lodash";
import { Check, Clock, FolderOpen, Loader2, Pencil, RefreshCw, Save, Tv, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

// Interval steps: 15, 30, 60, 120, 240, 720, 1440, 2880 (in minutes)
const INTERVAL_STEPS = [15, 30, 60, 120, 240, 720, 1440, 2880];

// Convert minutes to step index
const minutesToStep = (minutes: number): number => {
  let closestIndex = 0;
  let minDiff = Math.abs(INTERVAL_STEPS[0] - minutes);

  for (let i = 1; i < INTERVAL_STEPS.length; i++) {
    const diff = Math.abs(INTERVAL_STEPS[i] - minutes);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }

  return closestIndex;
};

// Convert step index to minutes
const stepToMinutes = (step: number): number => {
  return INTERVAL_STEPS[step] || INTERVAL_STEPS[0];
};

// Format minutes to readable string
const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
};

interface Task {
  id: string;
  name: string;
  description: string;
  intervalMinutes: number;
}

interface Configs {
  sonarr_enabled?: boolean;
  sonarr_url?: string;
  sonarr_token?: string;
  sonarr_filter_anime_only?: boolean;
  sonarr_auto_rename?: boolean;
  sonarr_tags_mode?: string;
  sonarr_tags?: Array<{ label: string; value: string }>;
}

interface ConfigInputs {
  sonarr_enabled: boolean;
  sonarr_url: string;
  sonarr_token: string;
  sonarr_filter_anime_only: boolean;
  sonarr_auto_rename: boolean;
  sonarr_tags_mode: string;
  sonarr_tags: string[];
}

export default function SonarrSettingsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [intervals, setIntervals] = useState<Record<string, number>>({});
  const [sonarrTags, setSonarrTags] = useState<Array<{ value: string; label: string }>>([]);
  const [configs, setConfigs] = useState<Configs>({});
  const [configInputs, setConfigInputs] = useState<ConfigInputs>({
    sonarr_enabled: true,
    sonarr_url: "",
    sonarr_token: "",
    sonarr_filter_anime_only: true,
    sonarr_auto_rename: false,
    sonarr_tags_mode: "blacklist",
    sonarr_tags: [],
  });
  const [loading, setLoading] = useState(true);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [mappingInputs, setMappingInputs] = useState<Record<number, string>>({});

  const [isSavingConfig, startSavingConfig] = useTransition();
  const [isSyncingRootFolders, startSyncingRootFolders] = useTransition();
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const saveConfig = useCallback(async (key: string, value: string) => {
    try {
      await apiUpdateConfig(key, value);
      toast.success("Configurazione aggiornata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio");
    }
  }, []);

  const debouncedSaveConfig = useMemo(
    () => debounce(saveConfig, 1000),
    [saveConfig]
  );

  const saveTaskInterval = useCallback(async (taskId: string, taskName: string, intervalMinutes: number) => {
    setSavingTaskId(taskId);
    try {
      await apiUpdateTaskInterval(taskId, intervalMinutes);
      toast.success(`Intervallo aggiornato per "${taskName}"`);
      await fetchTasksList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore aggiornamento");
    } finally {
      setSavingTaskId(null);
    }
  }, []);

  const debouncedSaveTaskInterval = useMemo(
    () => debounce(saveTaskInterval, 1000),
    [saveTaskInterval]
  );

  useEffect(() => {
    return () => {
      debouncedSaveConfig.cancel();
      debouncedSaveTaskInterval.cancel();
    };
  }, [debouncedSaveConfig, debouncedSaveTaskInterval]);

  useEffect(() => {
    fetchTasksList();
    fetchConfigsList();
    fetchRootFoldersList();
    fetchSonarrTagsList();
  }, []);

  const handleTaskIntervalChange = useCallback((taskId: string, taskName: string, stepIndex: number) => {
    const minutes = stepToMinutes(stepIndex);
    setIntervals(prev => ({ ...prev, [taskId]: minutes }));
    debouncedSaveTaskInterval(taskId, taskName, minutes);
  }, [debouncedSaveTaskInterval]);

  const fetchTasksList = async () => {
    try {
      const data = await apiFetchTasks("sonarr");
      setTasks(data as unknown as Task[]);

      const initialIntervals: Record<string, number> = {};
      (data as unknown as Task[]).forEach((task: Task) => {
        initialIntervals[task.id] = task.intervalMinutes;
      });
      setIntervals(initialIntervals);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore caricamento task");
    } finally {
      setLoading(false);
    }
  };

  const fetchConfigsList = async () => {
    try {
      const data = await apiFetchConfigs();
      setConfigs(data as Configs);

      let parsedTags: Array<{ value: string; label: string }> = [];
      if (data.sonarr_tags) {
        try {
          if (Array.isArray(data.sonarr_tags)) {
            parsedTags = data.sonarr_tags;
          } else if (typeof data.sonarr_tags === 'string') {
            parsedTags = JSON.parse(data.sonarr_tags);
          }
        } catch (e) {
          console.error('Error parsing sonarr_tags:', e);
          parsedTags = [];
        }
      }

      setConfigInputs({
        sonarr_enabled: typeof data.sonarr_enabled === 'boolean' ? data.sonarr_enabled : data.sonarr_enabled !== 'false',
        sonarr_url: data.sonarr_url || "",
        sonarr_token: "",
        sonarr_filter_anime_only: typeof data.sonarr_filter_anime_only === 'boolean' ? data.sonarr_filter_anime_only : data.sonarr_filter_anime_only !== 'false',
        sonarr_auto_rename: typeof data.sonarr_auto_rename === 'boolean' ? data.sonarr_auto_rename : data.sonarr_auto_rename === 'true',
        sonarr_tags_mode: data.sonarr_tags_mode || "blacklist",
        sonarr_tags: parsedTags.map((t: any) => String(t.value || t)),
      });
    } catch (err) {
      console.error("Error fetching configs:", err);
    }
  };

  const fetchRootFoldersList = async () => {
    try {
      const data = await fetchRootFolders("sonarr");
      setRootFolders(data);

      const mappings: Record<number, string> = {};
      data.forEach(folder => {
        mappings[folder.id] = folder.mappedPath || "";
      });
      setMappingInputs(mappings);
    } catch (err) {
      console.error("Error fetching root folders:", err);
    }
  };

  const fetchSonarrTagsList = async () => {
    try {
      const tags = await fetchSonarrTags();
      setSonarrTags(tags.map(tag => ({ value: String(tag.id), label: tag.label })));
    } catch (err) {
      console.error("Error fetching Sonarr tags:", err);
    }
  };

  const handleSyncRootFolders = () => {
    startSyncingRootFolders(async () => {
      try {
        const result = await syncRootFolders("sonarr");
        setRootFolders(result.rootFolders);

        const mappings: Record<number, string> = {};
        result.rootFolders.forEach(folder => {
          mappings[folder.id] = folder.mappedPath || "";
        });
        setMappingInputs(mappings);

        toast.success(result.message);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore sincronizzazione. Verifica che Sonarr sia raggiungibile.");
      }
    });
  };

  const handleSaveMapping = async (folderId: number) => {
    try {
      const mappedPath = mappingInputs[folderId] || null;
      await updateRootFolderMapping(folderId, mappedPath);
      await fetchRootFoldersList();
      setEditingMappingId(null);
      toast.success("Mappatura aggiornata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore aggiornamento mappatura");
    }
  };

  const handleConfigChange = (key: keyof Configs, value: string) => {
    setConfigInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleEnabledToggle = async (checked: boolean) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_enabled: checked }));
    try {
      await apiUpdateConfig("sonarr_enabled", checked);
      toast.success(checked ? "Integrazione Sonarr attivata" : "Integrazione Sonarr disattivata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio");
      setConfigInputs((prev) => ({ ...prev, sonarr_enabled: !checked }));
    }
  };

  const handleFilterAnimeOnlyToggle = async (checked: boolean) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_filter_anime_only: checked }));

    try {
      await apiUpdateConfig("sonarr_filter_anime_only", checked);
      setConfigs((prev) => ({ ...prev, sonarr_filter_anime_only: checked }));
      toast.success(checked ? "Filtro anime attivato" : "Filtro anime disattivato");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio impostazione");
      setConfigInputs((prev) => ({ ...prev, sonarr_filter_anime_only: !checked }));
    }
  };

  const handleAutoRenameToggle = async (checked: boolean) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_auto_rename: checked }));

    try {
      await apiUpdateConfig("sonarr_auto_rename", checked);
      setConfigs((prev) => ({ ...prev, sonarr_auto_rename: checked }));
      toast.success(checked ? "Rinomina automatica attivata" : "Rinomina automatica disattivata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio impostazione");
      setConfigInputs((prev) => ({ ...prev, sonarr_auto_rename: !checked }));
    }
  };

  const handleTagModeChange = async (value: string) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_tags_mode: value }));

    try {
      await apiUpdateConfig("sonarr_tags_mode", value);
      setConfigs((prev) => ({ ...prev, sonarr_tags_mode: value }));
      toast.success(`Modalità tag impostata su ${value === 'blacklist' ? 'blacklist' : 'whitelist'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio modalità tag");
      setConfigInputs((prev) => ({ ...prev, sonarr_tags_mode: configInputs.sonarr_tags_mode }));
    }
  };

  const handleTagsChange = async (selectedValues: string[]) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_tags: selectedValues }));

    try {
      const tagObjects = selectedValues.map(value => {
        const tag = sonarrTags.find(t => t.value === value);
        return { value, label: tag?.label || value };
      });
      await apiUpdateConfig("sonarr_tags", tagObjects);
      setConfigs((prev) => ({ ...prev, sonarr_tags: tagObjects }));
      toast.success("Tag aggiornati");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio tag");
      setConfigInputs((prev) => ({ ...prev, sonarr_tags: configInputs.sonarr_tags }));
    }
  };

  const handleSaveConfig = (configKey: keyof Configs) => {
    const value = configInputs[configKey];

    if (configKey === "sonarr_token" && !value) {
      toast.error("Inserisci un token per aggiornarlo");
      return;
    }

    setSavingConfigKey(configKey);
    startSavingConfig(async () => {
      try {
        await apiUpdateConfig(configKey, value);

        const configNames: Record<keyof Configs, string> = {
          sonarr_enabled: "Integrazione Sonarr",
          sonarr_url: "URL Sonarr",
          sonarr_token: "Token API",
          sonarr_filter_anime_only: "Filtra Solo Anime",
          sonarr_auto_rename: "Rinomina Automatica",
          sonarr_tags_mode: "Modalità Tag",
          sonarr_tags: "Tag",
        };

        const configName = configNames[configKey] || configKey;
        toast.success(`${configName} salvato con successo`);
        await fetchConfigsList();

        if (configKey === "sonarr_url" || configKey === "sonarr_token") {
          try {
            await forceSonarrHealthCheck();
          } catch (err) {
            console.error("Failed to check Sonarr health:", err);
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore salvataggio");
      } finally {
        setSavingConfigKey(null);
      }
    });
  };

  if (loading) {
    return (
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enable/Disable toggle */}
      <Card>
        <CardContent className="py-0">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="sonarr-enabled" className="text-base font-semibold cursor-pointer">
                Abilita integrazione Sonarr
              </Label>
              <p className="text-sm text-muted-foreground">
                Attiva la sincronizzazione automatica delle serie TV tramite Sonarr
              </p>
            </div>
            <Switch
              id="sonarr-enabled"
              checked={configInputs.sonarr_enabled}
              onCheckedChange={handleEnabledToggle}
            />
          </div>
        </CardContent>
      </Card>

      {configInputs.sonarr_enabled && <>
      {/* Sonarr Health Status */}
      <SonarrStatusBadge />

      {/* Sonarr Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tv className="h-5 w-5" />
            Configurazione Sonarr
          </CardTitle>
          <CardDescription>
            Configura la connessione al tuo server Sonarr
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Connection Settings */}
            <div className="space-y-4">
              {/* Sonarr URL */}
              <div className="space-y-2">
                <Label htmlFor="sonarr-url">URL Sonarr</Label>
                <div className="flex w-full items-center gap-2">
                  <Input
                    id="sonarr-url"
                    type="url"
                    value={configInputs.sonarr_url}
                    onChange={(e) => handleConfigChange("sonarr_url", e.target.value)}
                    placeholder="http://localhost:8989"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveConfig("sonarr_url")}
                    disabled={
                      (isSavingConfig && savingConfigKey === "sonarr_url") ||
                      !configInputs.sonarr_url ||
                      configInputs.sonarr_url === configs.sonarr_url
                    }
                  >
                    {isSavingConfig && savingConfigKey === "sonarr_url" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Salvataggio...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Salva
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Indirizzo completo della tua istanza Sonarr
                </p>
              </div>

              {/* Sonarr Token */}
              <div className="space-y-2">
                <Label htmlFor="sonarr-token">API Token</Label>
                <div className="flex w-full items-center gap-2">
                  <Input
                    id="sonarr-token"
                    type="password"
                    value={configInputs.sonarr_token}
                    onChange={(e) => handleConfigChange("sonarr_token", e.target.value)}
                    placeholder={configs.sonarr_token ? "••••••••••••••••••••••••••••••••" : "Inserisci il token API"}
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveConfig("sonarr_token")}
                    disabled={
                      (isSavingConfig && savingConfigKey === "sonarr_token") ||
                      !configInputs.sonarr_token
                    }
                  >
                    {isSavingConfig && savingConfigKey === "sonarr_token" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Salvataggio...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Salva
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Token API trovato in Impostazioni → Generale → Sicurezza
                </p>
                {configs.sonarr_token && (
                  <p className="text-xs text-green-600">
                    ✓ Token configurato (non modificato)
                  </p>
                )}
              </div>
            </div>

            {/* Right Column - Automation Settings */}
            <div className="space-y-4">
              {/* Filter Anime Only Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="filter-anime-only" className="cursor-pointer">
                    Filtra solo anime
                  </Label>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Considera solo le serie con tipologia &quot;Anime&quot; in Sonarr
                  </p>
                </div>
                <Switch
                  id="filter-anime-only"
                  checked={configInputs.sonarr_filter_anime_only}
                  onCheckedChange={handleFilterAnimeOnlyToggle}
                />
              </div>
              <div className="sm:hidden border-t my-4" />

              {/* Auto Rename Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="auto-rename" className="cursor-pointer">
                    Rinomina automatica
                  </Label>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Dopo l&apos;importazione, rinomina automaticamente i file secondo lo schema di Sonarr
                  </p>
                </div>
                <Switch
                  id="auto-rename"
                  checked={configInputs.sonarr_auto_rename}
                  onCheckedChange={handleAutoRenameToggle}
                />
              </div>
              <div className="sm:hidden border-t my-4" />

              {/* Tag Mode Selector */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="tag-mode">Modalità utilizzo tag</Label>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Seleziona come utilizzare i tag per filtrare le serie
                  </p>
                </div>
                <Select
                  value={configInputs.sonarr_tags_mode}
                  onValueChange={handleTagModeChange}
                >
                  <SelectTrigger id="tag-mode" className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Seleziona modalità" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blacklist">Escludi</SelectItem>
                    <SelectItem value="whitelist">Includi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:hidden border-t my-4" />

              {/* Tag Multi-select */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="tags">Tag</Label>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Seleziona i tag da utilizzare per il filtro
                  </p>
                </div>
                <div className="w-full sm:w-auto">
                  <MultiSelect
                    options={sonarrTags}
                    selected={configInputs.sonarr_tags}
                    onChange={handleTagsChange}
                    placeholder="Nessun tag selezionato"
                    emptyText="Nessun tag trovato"
                    searchPlaceholder="Cerca tag..."
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Root Folders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Root Folders Sonarr
              </CardTitle>
              <CardDescription>
                Gestisci le cartelle radice di Sonarr e le loro mappature locali
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSyncRootFolders}
              disabled={isSyncingRootFolders}
              title="Sincronizza root folders da Sonarr"
            >
              {isSyncingRootFolders ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rootFolders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>Nessuna root folder sincronizzata</p>
              <p className="text-sm mt-1">
                Clicca il pulsante di refresh per sincronizzare le root folders da Sonarr
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rootFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="grid grid-cols-[1fr_1fr_auto] gap-4 items-center py-3 border-b last:border-b-0"
                >
                  {/* Sonarr Path */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{folder.path}</p>
                      {!folder.accessible && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 whitespace-nowrap">
                          Offline
                        </span>
                      )}
                    </div>
                    {folder.freeSpace !== null && folder.totalSpace !== null && (
                      <p className="text-xs text-muted-foreground">
                        {(folder.freeSpace / (1024 ** 3)).toFixed(1)} GB / {(folder.totalSpace / (1024 ** 3)).toFixed(1)} GB liberi
                      </p>
                    )}
                  </div>

                  {/* Mapped Path or Input */}
                  <div className="min-w-0">
                    {editingMappingId === folder.id ? (
                      <Input
                        type="text"
                        value={mappingInputs[folder.id] || ""}
                        onChange={(e) =>
                          setMappingInputs((prev) => ({
                            ...prev,
                            [folder.id]: e.target.value,
                          }))
                        }
                        placeholder="es. /tvseries"
                        className="h-8 text-sm"
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground truncate">
                        {folder.mappedPath || folder.path}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {editingMappingId === folder.id ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                          onClick={() => handleSaveMapping(folder.id)}
                          disabled={mappingInputs[folder.id] === folder.mappedPath}
                          title="Salva"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingMappingId(null);
                            setMappingInputs((prev) => ({
                              ...prev,
                              [folder.id]: folder.mappedPath || "",
                            }));
                          }}
                          title="Annulla"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditingMappingId(folder.id)}
                        title="Modifica mappatura"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tasks Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Task Automatici
          </CardTitle>
          <CardDescription>
            Configura gli intervalli di esecuzione dei task
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {tasks.map((task) => (
            <div key={task.id} className="space-y-3 pb-6 border-b last:border-0 last:pb-0">
              <div>
                <Label className="font-semibold">{task.name}</Label>
                <p className="text-xs text-muted-foreground">{task.description}</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`interval-${task.id}`} className="text-sm">
                    Intervallo
                  </Label>
                  <span className="text-sm font-medium">{formatMinutes(intervals[task.id] || 15)}</span>
                </div>
                <Slider
                  id={`interval-${task.id}`}
                  min={0}
                  max={INTERVAL_STEPS.length - 1}
                  step={1}
                  value={[minutesToStep(intervals[task.id] || 15)]}
                  onValueChange={(value) => handleTaskIntervalChange(task.id, task.name, value[0])}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
