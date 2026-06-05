"use client";

import { useEffect, useState } from "react";
import { Clock, PlayCircle, CheckCircle, XCircle, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchTasks as apiFetchTasks, executeTask as apiExecuteTask, fetchConfigs } from "@/lib/api";

interface Task {
  id: string;
  name: string;
  description: string;
  serviceType: "sonarr" | "radarr" | "general";
  intervalMinutes: number;
  cronExpression: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: "idle" | "running" | "success" | "error";
  lastError: string | null;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [sonarrEnabled, setSonarrEnabled] = useState(true);
  const [radarrEnabled, setRadarrEnabled] = useState(false);

  useEffect(() => {
    fetchConfigs().then((configs) => {
      const se = configs.sonarr_enabled;
      setSonarrEnabled(typeof se === 'boolean' ? se : se !== 'false');
      const re = configs.radarr_enabled;
      setRadarrEnabled(typeof re === 'boolean' ? re : re === 'true');
    }).catch(() => {});
    fetchTasksList();
    const interval = setInterval(fetchTasksList, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchTasksList = async () => {
    try {
      const data = await apiFetchTasks();
      setTasks(data as unknown as Task[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteNow = async (taskId: string) => {
    setExecuting(taskId);
    try {
      await apiExecuteTask(taskId);
      
      // Refresh task list immediately to show running status
      await fetchTasksList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExecuting(null);
    }
  };

  const getStatusIcon = (status: Task["status"]) => {
    switch (status) {
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <PlayCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: Task["status"]) => {
    const styles = {
      idle: "bg-muted text-muted-foreground",
      running: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300",
      success: "bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-300",
      error: "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300",
    };
    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status]}`}
      >
        {status}
      </span>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Mai eseguito";
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  };

  const getTimeUntilNext = (nextRunAt: string | null) => {
    if (!nextRunAt) return "N/A";
    const now = new Date();
    const next = new Date(nextRunAt);
    const diff = next.getTime() - now.getTime();

    if (diff < 0) return "In esecuzione...";

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `in ${days} giorni`;
    if (hours > 0) return `in ${hours} ore`;
    if (minutes > 0) return `in ${minutes} minuti`;
    return "tra meno di un minuto";
  };

  const formatInterval = (minutes: number) => {
    if (minutes < 60) return `${minutes} minuti`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ore`;
    const days = Math.floor(hours / 24);
    return `${days} giorni`;
  };

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">Tasks Programmati</h1>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">Tasks Programmati</h1>
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm sm:text-base text-red-800 dark:text-red-200">Errore nel caricamento dei tasks: {error}</p>
          <p className="text-xs sm:text-sm text-red-600 dark:text-red-400 mt-2">
            Assicurati che il backend sia in esecuzione su{" "}
            {process.env.NEXT_PUBLIC_API_URL}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">Tasks Programmati</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Monitora i task automatici con informazioni sulla prossima esecuzione
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-muted border rounded-lg p-6 sm:p-8 text-center">
          <Clock className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm sm:text-base text-foreground font-medium">Nessun task configurato</p>
          <p className="text-xs sm:text-sm text-muted-foreground mt-2">
            I task automatici appariranno qui quando verranno creati
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="border rounded-lg p-3 sm:p-4 transition-colors bg-card hover:bg-muted/50"
            >
              <div className="flex flex-col sm:flex-row items-start justify-between mb-3 gap-3">
                <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                  <div className="mt-1">{getStatusIcon(task.status)}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base sm:text-lg break-words">{task.name}</h3>
                    {task.description && (
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1 break-words">
                        {task.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {getStatusBadge(task.status)}
                  {(task.serviceType === "sonarr" && !sonarrEnabled) ||
                   (task.serviceType === "radarr" && !radarrEnabled) ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground flex-1 sm:flex-initial text-center">
                      Disabilitato
                    </span>
                  ) : (
                    <Button
                      onClick={() => handleExecuteNow(task.id)}
                      disabled={task.status === "running" || executing === task.id}
                      size="sm"
                      variant="outline"
                      className="flex-1 sm:flex-initial"
                    >
                      {executing === task.id ? (
                        <>
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          Avvio...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-3 w-3" />
                          Esegui Ora
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Intervallo
                  </p>
                  <p className="text-xs sm:text-sm font-medium">
                    Ogni {formatInterval(task.intervalMinutes)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Ultima Esecuzione
                  </p>
                  <p className="text-xs sm:text-sm font-medium">
                    {formatDate(task.lastRunAt)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Prossima Esecuzione
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <p className="text-xs sm:text-sm font-medium">
                      {formatDate(task.nextRunAt)}
                    </p>
                    {task.nextRunAt && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        ({getTimeUntilNext(task.nextRunAt)})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {task.lastError && (
                <div className="mt-3 sm:mt-4 p-2 sm:p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded">
                  <p className="text-xs font-medium text-red-800 dark:text-red-200 mb-1">
                    Ultimo Errore:
                  </p>
                  <p className="text-xs sm:text-sm text-red-700 dark:text-red-300 break-words">{task.lastError}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
