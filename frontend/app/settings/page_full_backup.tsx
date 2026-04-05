"use client";

import { useEffect, useState, useCallback, useRef, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NotificationDialog } from "@/components/notification-dialog";
import { Clock, Save, Loader2, Server, Settings2, AlertTriangle, RefreshCw, FolderOpen, Pencil, Check, X, AlertTriangleIcon, Bell, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { debounce } from "lodash";
import {
  fetchTasks as apiFetchTasks,
  fetchConfigs as apiFetchConfigs,
  updateConfig as apiUpdateConfig,
  updateTaskInterval as apiUpdateTaskInterval,
  fetchRootFolders,
  syncRootFolders,
  updateRootFolderMapping,
  forceSonarrHealthCheck,
  fetchSonarrTags,
  fetchNotifications,
  updateNotification,
  deleteNotification,
  testNotification,
  type RootFolder,
  type SonarrTag,
  type Notification,
} from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const languageLabels: Record<string, string> = {
  dub: "Doppiato",
  sub: "Sottotitolato",
  dub_fallback_sub: "Doppiato (fallback su sub)"
};

// Interval steps: 15, 30, 60, 120, 240, 480, 960, 1920 (in minutes)
const INTERVAL_STEPS = [15, 30, 60, 120, 240, 720, 1440, 2880];

// Convert minutes to step index
const minutesToStep = (minutes: number): number => {
  // Find the closest step
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
  sonarr_url?: string;
  sonarr_token?: string;
  sonarr_filter_anime_only?: boolean;
  sonarr_auto_rename?: boolean;
  sonarr_tags_mode?: string;
  sonarr_tags?: Array<{ label: string; value: string }>;
  animeworld_base_url?: string;
  preferred_language?: string;
  download_max_workers?: string;
  concurrent_downloads?: string;
}

interface ConfigInputs {
  sonarr_url: string;
  sonarr_token: string;
  sonarr_filter_anime_only: boolean;
  sonarr_auto_rename: boolean;
  sonarr_tags_mode: string;
  sonarr_tags: string[];
  animeworld_base_url: string;
  preferred_language: string;
  download_max_workers: string;
  concurrent_downloads: string;
}

const EventsBadge = ({ notification }: { notification: Notification }) => {
  return (<div className="flex items-center gap-1 pl-11">
    {notification.events.length === 1 ? (
      <span className="text-xs bg-muted px-2 py-0.5 rounded">
        {notification.events[0] === 'onDownloadSuccessful' ? 'Download Completato' : 'Errore Download'}
      </span>
    ) : (
      <span className="text-xs bg-muted px-2 py-0.5 rounded">
        {notification.events.length} eventi
      </span>
    )}
  </div>)
}

export default function ImpostazioniPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [intervals, setIntervals] = useState<Record<string, number>>({});
  const [sonarrTags, setSonarrTags] = useState<Array<{ value: string; label: string }>>([]);
  const [configs, setConfigs] = useState<Configs>({});
  const [configInputs, setConfigInputs] = useState<ConfigInputs>({
    sonarr_url: "",
    sonarr_token: "",
    sonarr_filter_anime_only: true,
    sonarr_auto_rename: false,
    sonarr_tags_mode: "blacklist",
    sonarr_tags: [],
    animeworld_base_url: "",
    preferred_language: "sub",
    download_max_workers: "2",
    concurrent_downloads: "2",
  });
  const [loading, setLoading] = useState(true);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [mappingInputs, setMappingInputs] = useState<Record<number, string>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<{ id: number; name: string } | null>(null);

  // Use transitions for loading states
  const [isSavingConfig, startSavingConfig] = useTransition();
  const [isSyncingRootFolders, startSyncingRootFolders] = useTransition();
  const [isDeletingNotification, startDeletingNotification] = useTransition();
  const [isTestingNotification, startTestingNotification] = useTransition();
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [testingNotificationId, setTestingNotificationId] = useState<number | null>(null);
  const [deletingNotificationId, setDeletingNotificationId] = useState<number | null>(null);

  // Calculate total concurrent requests
  const totalConcurrentRequests = useMemo(() => {
    const workers = parseInt(configInputs.download_max_workers) || 2;
    const downloads = parseInt(configInputs.concurrent_downloads) || 2;
    return workers * downloads;
  }, [configInputs.download_max_workers, configInputs.concurrent_downloads]);

  // Check if total requests is too high
  const isTooManyRequests = useMemo(() => totalConcurrentRequests > 10, [totalConcurrentRequests]);

  // Save config with debounce
  const saveConfig = useCallback(async (key: string, value: string) => {
    try {
      await apiUpdateConfig(key, value);
      const configName = key === 'download_max_workers' ? 'Worker Download' : key === 'concurrent_downloads' ? 'Download Simultanei' : key;
      toast.success(`${configName} aggiornato`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio");
    }
  }, []);

  // Debounced version of saveConfig
  const debouncedSaveConfig = useMemo(
    () => debounce(saveConfig, 1000),
    [saveConfig]
  );

  // Save task interval with debounce (keeps simple loading for tasks)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
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

  // Debounced version of saveTaskInterval
  const debouncedSaveTaskInterval = useMemo(
    () => debounce(saveTaskInterval, 1000),
    [saveTaskInterval]
  );

  // Cleanup debounced functions on unmount
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
    fetchNotificationsList();
  }, []);

  // Handler for config changes (download workers, concurrent downloads)
  const handleConfigSliderChange = useCallback((key: string, value: number) => {
    const stringValue = value.toString();
    setConfigInputs(prev => ({
      ...prev,
      [key]: stringValue
    }));
    debouncedSaveConfig(key, stringValue);
  }, [debouncedSaveConfig]);

  // Handler for task interval changes
  const handleTaskIntervalChange = useCallback((taskId: string, taskName: string, stepIndex: number) => {
    const minutes = stepToMinutes(stepIndex);
    setIntervals(prev => ({ ...prev, [taskId]: minutes }));
    debouncedSaveTaskInterval(taskId, taskName, minutes);
  }, [debouncedSaveTaskInterval]);

  const fetchTasksList = async () => {
    try {
      const data = await apiFetchTasks();
      setTasks(data as unknown as Task[]);

      // Initialize intervals
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

      // Parse sonarr_tags if it's a JSON string
      let parsedTags: Array<{ value: string; label: string }> = [];
      if (data.sonarr_tags) {
        try {
          // If it's already an array, use it directly
          if (Array.isArray(data.sonarr_tags)) {
            parsedTags = data.sonarr_tags;
          } else if (typeof data.sonarr_tags === 'string') {
            // If it's a string, parse it
            parsedTags = JSON.parse(data.sonarr_tags);
          }
        } catch (e) {
          console.error('Error parsing sonarr_tags:', e);
          parsedTags = [];
        }
      }

      // Initialize inputs with current values (token stays empty for security)
      setConfigInputs({
        sonarr_url: data.sonarr_url || "",
        sonarr_token: "", // Never show the token
        sonarr_filter_anime_only: typeof data.sonarr_filter_anime_only === 'boolean' ? data.sonarr_filter_anime_only : data.sonarr_filter_anime_only !== 'false',
        sonarr_auto_rename: typeof data.sonarr_auto_rename === 'boolean' ? data.sonarr_auto_rename : data.sonarr_auto_rename === 'true',
        sonarr_tags_mode: data.sonarr_tags_mode || "blacklist",
        sonarr_tags: parsedTags.map((t: any) => String(t.value || t)),
        animeworld_base_url: data.animeworld_base_url || "",
        preferred_language: data.preferred_language || "sub",
        download_max_workers: data.download_max_workers || "2",
        concurrent_downloads: data.concurrent_downloads || "2",
      });
    } catch (err) {
      console.error("Error fetching configs:", err);
    }
  };

  const fetchRootFoldersList = async () => {
    try {
      const data = await fetchRootFolders();
      setRootFolders(data);

      // Initialize mapping inputs
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

  const fetchNotificationsList = async () => {
    try {
      const data = await fetchNotifications();
      setNotifications(data);
    } catch (err) {
      console.error("Error fetching notifications:", err);
    }
  };

  const handleToggleNotification = async (id: number, enabled: boolean) => {
    try {
      await updateNotification(id, { enabled });
      await fetchNotificationsList();
      toast.success(enabled ? "Notifica attivata" : "Notifica disattivata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore aggiornamento notifica");
    }
  };

  const handleDeleteNotification = (id: number, name: string) => {
    setNotificationToDelete({ id, name });
    setDeleteAlertOpen(true);
  };

  const confirmDeleteNotification = () => {
    if (!notificationToDelete) return;

    const { id } = notificationToDelete;
    setDeletingNotificationId(id);
    startDeletingNotification(async () => {
      try {
        await deleteNotification(id);
        await fetchNotificationsList();
        toast.success("Notifica eliminata");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore eliminazione notifica");
      } finally {
        setDeletingNotificationId(null);
        setDeleteAlertOpen(false);
        setNotificationToDelete(null);
      }
    });
  };

  const handleTestNotification = (id: number) => {
    setTestingNotificationId(id);
    startTestingNotification(async () => {
      try {
        await testNotification(id);
        toast.success("Notifica di test inviata");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore invio notifica di test");
      } finally {
        setTestingNotificationId(null);
      }
    });
  };

  const handleSyncRootFolders = () => {
    startSyncingRootFolders(async () => {
      try {
        const result = await syncRootFolders();
        setRootFolders(result.rootFolders);

        // Update mapping inputs
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

  const handleFilterAnimeOnlyToggle = async (checked: boolean) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_filter_anime_only: checked }));

    try {
      await apiUpdateConfig("sonarr_filter_anime_only", checked);
      setConfigs((prev) => ({ ...prev, sonarr_filter_anime_only: checked }));
      toast.success(checked ? "Filtro anime attivato" : "Filtro anime disattivato");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio impostazione");
      // Revert on error
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
      // Revert on error
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
      // Revert on error
      setConfigInputs((prev) => ({ ...prev, sonarr_tags_mode: configInputs.sonarr_tags_mode }));
    }
  };

  const handleTagsChange = async (selectedValues: string[]) => {
    setConfigInputs((prev) => ({ ...prev, sonarr_tags: selectedValues }));

    try {
      // Convert to array of objects with value and label
      const tagObjects = selectedValues.map(value => {
        const tag = sonarrTags.find(t => t.value === value);
        return { value, label: tag?.label || value };
      });
      await apiUpdateConfig("sonarr_tags", tagObjects);
      setConfigs((prev) => ({ ...prev, sonarr_tags: tagObjects }));
      toast.success("Tag aggiornati");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio tag");
      // Revert on error
      setConfigInputs((prev) => ({ ...prev, sonarr_tags: configInputs.sonarr_tags }));
    }
  };

  const handlePreferredLanguageChange = async (value: string) => {
    setConfigInputs((prev) => ({ ...prev, preferred_language: value }));

    try {
      await apiUpdateConfig("preferred_language", value);
      setConfigs((prev) => ({ ...prev, preferred_language: value }));
      toast.success(`Lingua preferita impostata su: ${languageLabels[value] || value}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio lingua preferita");
      // Revert on error
      setConfigInputs((prev) => ({ ...prev, preferred_language: configInputs.preferred_language }));
    }
  };

  const handleSaveConfig = (configKey: keyof Configs) => {
    const value = configInputs[configKey];

    // Don't save if token is empty (means unchanged)
    if (configKey === "sonarr_token" && !value) {
      toast.error("Inserisci un token per aggiornarlo");
      return;
    }

    setSavingConfigKey(configKey);
    startSavingConfig(async () => {
      try {
        await apiUpdateConfig(configKey, value);

        const configNames: Record<keyof Configs, string> = {
          sonarr_url: "URL Sonarr",
          sonarr_token: "Token API",
          sonarr_filter_anime_only: "Filtra Solo Anime",
          sonarr_auto_rename: "Rinomina Automatica",
          sonarr_tags_mode: "Modalità Tag",
          sonarr_tags: "Tag",
          animeworld_base_url: "URL Base AnimeWorld",
          preferred_language: "Lingua Preferita",
          download_max_workers: "Worker Download",
          concurrent_downloads: "Download Simultanei",
        };

        const configName = configNames[configKey] || configKey;
        toast.success(`${configName} salvato con successo`);
        await fetchConfigsList();

        // Force health check after saving Sonarr config
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
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-4">Impostazioni</h1>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">Impostazioni</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Configura Sonarr e gli intervalli dei task automatici
        </p>
      </div>

      <div className="space-y-4">
        {/* Sonarr Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
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

        {/* Root Folders - Always visible */}
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

        {/* Application Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Configurazione Applicazione
            </CardTitle>
            <CardDescription>
              Configura i parametri dell'applicazione
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Connection Settings */}
              <div className="space-y-4">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="animeworld-url">URL Base AnimeWorld</Label>
                  <div className="flex w-full items-center gap-2">
                    <Input
                      id="animeworld-url"
                      type="url"
                      value={configInputs.animeworld_base_url}
                      onChange={(e) => handleConfigChange("animeworld_base_url", e.target.value)}
                      placeholder="https://www.animeworld.ac"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveConfig("animeworld_base_url")}
                      disabled={
                        (isSavingConfig && savingConfigKey === "animeworld_base_url") ||
                        !configInputs.animeworld_base_url ||
                        configInputs.animeworld_base_url === configs.animeworld_base_url
                      }
                    >
                      {isSavingConfig && savingConfigKey === "animeworld_base_url" ? (
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
                    URL base del sito AnimeWorld per la ricerca degli episodi
                  </p>
                  {configs.animeworld_base_url && (
                    <p className="text-xs text-green-600">
                      ✓ URL configurato: {configs.animeworld_base_url}
                    </p>
                  )}
                </div>

                {/* Preferred Language Selector */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                  <div className="space-y-1 flex-1">
                    <Label htmlFor="preferred-language">Lingua preferita</Label>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Seleziona la lingua preferita per gli episodi
                    </p>
                  </div>
                  <Select
                    value={configInputs.preferred_language}
                    onValueChange={handlePreferredLanguageChange}
                  >
                    <SelectTrigger id="preferred-language" className="w-full sm:w-[200px]">
                      <SelectValue placeholder="Seleziona lingua" />
                    </SelectTrigger>
                    <SelectContent>
                      {languageLabels && Object.entries(languageLabels).map(([code, label]) => (
                        <SelectItem key={code} value={code}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-4">
                {/* Max Workers */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="download-max-workers">Worker Download Simultanei</Label>
                    <span className="text-sm font-medium">{configInputs.download_max_workers}</span>
                  </div>
                  <Slider
                    id="download-max-workers"
                    min={1}
                    max={10}
                    step={1}
                    value={[parseInt(configInputs.download_max_workers) || 2]}
                    onValueChange={(value) => handleConfigSliderChange("download_max_workers", value[0])}
                  />
                  <p className="text-xs text-muted-foreground">
                    Numero di worker threads per scaricare chunk in parallelo per ogni download (1-10)
                  </p>
                </div>

                {/* Concurrent Downloads */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="concurrent-downloads">Download Simultanei</Label>
                    <span className="text-sm font-medium">{configInputs.concurrent_downloads}</span>
                  </div>
                  <Slider
                    id="concurrent-downloads"
                    min={1}
                    max={10}
                    step={1}
                    value={[parseInt(configInputs.concurrent_downloads) || 2]}
                    onValueChange={(value) => handleConfigSliderChange("concurrent_downloads", value[0])}
                  />
                  <p className="text-xs text-muted-foreground">
                    Numero massimo di download che possono essere eseguiti contemporaneamente nella coda (1-10)
                  </p>
                </div>

                {/* Alert for too many concurrent requests */}
                {isTooManyRequests && (
                  <Alert className="text-amber-600 border-amber-300 dark:border-amber-800">
                    <AlertTriangleIcon />
                    <AlertTitle>Attenzione: Troppe richieste simultanee.</AlertTitle>
                    <AlertDescription>
                      <p>Stai configurando <strong>{totalConcurrentRequests} richieste simultanee</strong> ({configInputs.concurrent_downloads} download × {configInputs.download_max_workers} worker).
                        Questo potrebbe sovraccaricare il server di origine e causare errori o ban temporanei.</p>
                      <p><strong>Consigliato:</strong> mantenere il totale sotto i 10 worker simultanei.</p>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

            </div>
            {/* AnimeWorld Base URL */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full">


            </div>

          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifiche
                </CardTitle>
                <CardDescription>
                  Configura le notifiche per i download
                </CardDescription>
              </div>
              <NotificationDialog onSuccess={fetchNotificationsList} />
            </div>
          </CardHeader>
          <CardContent>
            {/* Notifications list */}
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>Nessuna notifica configurata</p>
                <p className="text-sm mt-1">
                  Clicca su "Aggiungi" per configurare la tua prima notifica
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto] gap-2 sm:gap-4 sm:items-center py-3 border-b last:border-b-0"
                  >
                    {/* First row on mobile: Toggle + Name/URL + Actions */}
                    <div className="flex items-center gap-3 sm:contents">
                      {/* Toggle */}
                      <Switch
                        checked={notification.enabled}
                        onCheckedChange={(checked) => handleToggleNotification(notification.id, checked)}
                      />

                      {/* Name and URL */}
                      <div className="min-w-0 flex-1 sm:flex-none">
                        <p className="text-sm font-medium">{notification.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground truncate">{notification.url}</p>
                          {/* Events badge - visible on desktop next to URL */}
                          {notification.events && notification.events.length > 0 && (
                            <div className="hidden sm:block flex-shrink-0">
                              <EventsBadge notification={notification} />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions - visible on mobile in first row */}
                      <div className="flex items-center gap-1 sm:contents">
                        {/* Edit Button */}
                        <NotificationDialog
                          notification={notification}
                          onSuccess={fetchNotificationsList}
                        />

                        {/* Test Button */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleTestNotification(notification.id)}
                          disabled={isTestingNotification && testingNotificationId === notification.id}
                          title="Invia notifica di test"
                        >
                          {isTestingNotification && testingNotificationId === notification.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Delete Button */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDeleteNotification(notification.id, notification.name)}
                          disabled={isDeletingNotification && deletingNotificationId === notification.id}
                          title="Elimina"
                        >
                          {isDeletingNotification && deletingNotificationId === notification.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Second row on mobile: Events (if any) */}
                    {notification.events && notification.events.length > 0 && (
                      <div className="sm:hidden">
                        <EventsBadge notification={notification}></EventsBadge>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation AlertDialog */}
        <AlertDialog open={deleteAlertOpen} onOpenChange={setDeleteAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
              <AlertDialogDescription>
                Sei sicuro di voler eliminare la notifica &quot;{notificationToDelete?.name}&quot;?
                Questa azione non può essere annullata.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annulla</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteNotification}
                className="bg-red-600 hover:bg-red-700"
              >
                Elimina
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
      </div>
    </div>
  );
}
