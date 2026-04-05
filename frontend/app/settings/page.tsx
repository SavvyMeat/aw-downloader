"use client";

import { useEffect, useState, useCallback, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NotificationDialog } from "@/components/notification-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Save, Loader2, Settings2, AlertTriangleIcon, Bell, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { debounce } from "lodash";
import {
  fetchConfigs as apiFetchConfigs,
  updateConfig as apiUpdateConfig,
  fetchNotifications,
  updateNotification,
  deleteNotification,
  testNotification,
  type Notification,
} from "@/lib/api";

const languageLabels: Record<string, string> = {
  dub: "Doppiato",
  sub: "Sottotitolato",
  dub_fallback_sub: "Doppiato (fallback su sub)"
};

interface Configs {
  animeworld_base_url?: string;
  preferred_language?: string;
  download_max_workers?: string;
  concurrent_downloads?: string;
}

interface ConfigInputs {
  animeworld_base_url: string;
  preferred_language: string;
  download_max_workers: string;
  concurrent_downloads: string;
}

const EventsBadge = ({ notification }: { notification: Notification }) => {
  return (
    <div className="flex items-center gap-1 pl-11">
      {notification.events.length === 1 ? (
        <span className="text-xs bg-muted px-2 py-0.5 rounded">
          {notification.events[0] === 'onDownloadSuccessful' ? 'Download Completato' : 'Errore Download'}
        </span>
      ) : (
        <span className="text-xs bg-muted px-2 py-0.5 rounded">
          {notification.events.length} eventi
        </span>
      )}
    </div>
  );
};

export default function GeneralSettingsPage() {
  const [configs, setConfigs] = useState<Configs>({});
  const [configInputs, setConfigInputs] = useState<ConfigInputs>({
    animeworld_base_url: "",
    preferred_language: "sub",
    download_max_workers: "2",
    concurrent_downloads: "2",
  });
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<{ id: number; name: string } | null>(null);

  const [isSavingConfig, startSavingConfig] = useTransition();
  const [isDeletingNotification, startDeletingNotification] = useTransition();
  const [isTestingNotification, startTestingNotification] = useTransition();
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [testingNotificationId, setTestingNotificationId] = useState<number | null>(null);
  const [deletingNotificationId, setDeletingNotificationId] = useState<number | null>(null);

  const totalConcurrentRequests = useMemo(() => {
    const workers = parseInt(configInputs.download_max_workers) || 2;
    const downloads = parseInt(configInputs.concurrent_downloads) || 2;
    return workers * downloads;
  }, [configInputs.download_max_workers, configInputs.concurrent_downloads]);

  const isTooManyRequests = useMemo(() => totalConcurrentRequests > 10, [totalConcurrentRequests]);

  const saveConfig = useCallback(async (key: string, value: string) => {
    try {
      await apiUpdateConfig(key, value);
      const configName = key === 'download_max_workers' ? 'Worker Download' : key === 'concurrent_downloads' ? 'Download Simultanei' : key;
      toast.success(`${configName} aggiornato`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore salvataggio");
    }
  }, []);

  const debouncedSaveConfig = useMemo(
    () => debounce(saveConfig, 1000),
    [saveConfig]
  );

  useEffect(() => {
    return () => {
      debouncedSaveConfig.cancel();
    };
  }, [debouncedSaveConfig]);

  useEffect(() => {
    fetchConfigsList();
    fetchNotificationsList();
  }, []);

  const handleConfigSliderChange = useCallback((key: string, value: number) => {
    const stringValue = value.toString();
    setConfigInputs(prev => ({
      ...prev,
      [key]: stringValue
    }));
    debouncedSaveConfig(key, stringValue);
  }, [debouncedSaveConfig]);

  const fetchConfigsList = async () => {
    try {
      const data = await apiFetchConfigs();
      setConfigs(data as Configs);

      setConfigInputs({
        animeworld_base_url: data.animeworld_base_url || "",
        preferred_language: data.preferred_language || "sub",
        download_max_workers: data.download_max_workers || "2",
        concurrent_downloads: data.concurrent_downloads || "2",
      });
    } catch (err) {
      console.error("Error fetching configs:", err);
    } finally {
      setLoading(false);
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
      const notification = notifications.find(n => n.id === id);
      if (!notification) return;

      await updateNotification(id, {
        name: notification.name,
        url: notification.url,
        events: notification.events,
        enabled
      });

      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, enabled } : n)
      );

      toast.success(`Notifica ${enabled ? 'attivata' : 'disattivata'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore aggiornamento notifica");
    }
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

  const handleDeleteNotification = (id: number, name: string) => {
    setNotificationToDelete({ id, name });
    setDeleteAlertOpen(true);
  };

  const confirmDeleteNotification = () => {
    if (!notificationToDelete) return;

    setDeletingNotificationId(notificationToDelete.id);
    startDeletingNotification(async () => {
      try {
        await deleteNotification(notificationToDelete.id);
        toast.success("Notifica eliminata");
        await fetchNotificationsList();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore eliminazione notifica");
      } finally {
        setDeleteAlertOpen(false);
        setNotificationToDelete(null);
        setDeletingNotificationId(null);
      }
    });
  };

  const handleConfigChange = (key: string, value: string) => {
    setConfigInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handlePreferredLanguageChange = useCallback((value: string) => {
    setConfigInputs(prev => ({ ...prev, preferred_language: value }));
    startSavingConfig(async () => {
      try {
        await apiUpdateConfig("preferred_language", value);
        toast.success(`Lingua preferita impostata su: ${languageLabels[value] || value}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore salvataggio lingua preferita");
      }
    });
  }, []);

  const handleSaveConfig = useCallback((configKey: string) => {
    const value = configInputs[configKey as keyof ConfigInputs];
    setSavingConfigKey(configKey);
    startSavingConfig(async () => {
      try {
        await apiUpdateConfig(configKey, value);
        toast.success("Configurazione aggiornata");
        await fetchConfigsList();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore salvataggio");
      } finally {
        setSavingConfigKey(null);
      }
    });
  }, [configInputs]);

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
            {/* Left Column - AnimeWorld Settings */}
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
                    {Object.entries(languageLabels).map(([code, label]) => (
                      <SelectItem key={code} value={code}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Column - Download Settings */}
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
                  <AlertTriangleIcon className="h-4 w-4" />
                  <AlertTitle>Attenzione: Troppe richieste simultanee</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">
                      Stai configurando <strong>{totalConcurrentRequests} richieste simultanee</strong> ({configInputs.concurrent_downloads} download × {configInputs.download_max_workers} worker).
                      Questo potrebbe sovraccaricare il server di origine e causare errori o ban temporanei.
                    </p>
                    <p><strong>Consigliato:</strong> mantenere il totale sotto i 10 worker simultanei.</p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
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
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>Nessuna notifica configurata</p>
              <p className="text-sm mt-1">
                Clicca su &quot;Aggiungi&quot; per configurare la tua prima notifica
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto] gap-2 sm:gap-4 sm:items-center py-3 border-b last:border-b-0"
                >
                  <div className="flex items-center gap-3 sm:contents">
                    <Switch
                      checked={notification.enabled}
                      onCheckedChange={(checked) => handleToggleNotification(notification.id, checked)}
                    />

                    <div className="min-w-0 flex-1 sm:flex-none">
                      <p className="text-sm font-medium">{notification.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground truncate">{notification.url}</p>
                        {notification.events && notification.events.length > 0 && (
                          <div className="hidden sm:block flex-shrink-0">
                            <EventsBadge notification={notification} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:contents">
                      <NotificationDialog
                        notification={notification}
                        onSuccess={fetchNotificationsList}
                      />

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

                  {notification.events && notification.events.length > 0 && (
                    <div className="sm:hidden">
                      <EventsBadge notification={notification} />
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
    </div>
  );
}
