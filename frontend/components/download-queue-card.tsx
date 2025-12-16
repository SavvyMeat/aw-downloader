"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Download, 
  Loader2, 
  X, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Trash2,
  StopCircle
} from "lucide-react";
import {
  fetchDownloadQueue,
  removeFromQueue,
  clearCompletedQueue,
  stopAllDownloads,
  type QueueItem,
  type QueueConfig,
} from "@/lib/api";

export default function DownloadQueueCard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [config, setConfig] = useState<QueueConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemToCancel, setItemToCancel] = useState<QueueItem | null>(null);
  const [showStopAllDialog, setShowStopAllDialog] = useState(false);

  useEffect(() => {
    fetchQueue();
    
    // Auto-refresh every 3 seconds
    const interval = setInterval(fetchQueue, 3000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchQueue = async () => {
    try {
      const data = await fetchDownloadQueue();
      setItems(data.items);
      setConfig(data.config);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    const item = items.find(i => i.id === id);
    
    // If it's an active download, ask for confirmation
    if (item && item.status === "downloading") {
      setItemToCancel(item);
      return;
    }
    
    // For pending items, remove directly
    try {
      await removeFromQueue(id);
      await fetchQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const confirmCancelDownload = async () => {
    if (!itemToCancel) return;
    
    try {
      await removeFromQueue(itemToCancel.id);
      await fetchQueue();
      setItemToCancel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleClearCompleted = async () => {
    try {
      await clearCompletedQueue();
      await fetchQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleStopAll = async () => {
    try {
      const result = await stopAllDownloads();
      await fetchQueue();
      setShowStopAllDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    const mbps = bytesPerSecond / (1024 * 1024);
    if (mbps >= 1) {
      return `${mbps.toFixed(2)} MB/s`;
    }
    const kbps = bytesPerSecond / 1024;
    return `${kbps.toFixed(2)} KB/s`;
  };

  const getStatusIcon = (status: QueueItem["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "downloading":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (status: QueueItem["status"]) => {
    switch (status) {
      case "pending":
        return "In coda";
      case "downloading":
        return "Download in corso";
      case "completed":
        return "Completato";
      case "failed":
        return "Fallito";
    }
  };

  const pendingItems = items.filter(i => i.status === "pending");
  const activeItems = items.filter(i => i.status === "downloading");
  const completedItems = items.filter(i => i.status === "completed");
  const failedItems = items.filter(i => i.status === "failed");

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Coda Download
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Download className="h-4 w-4 sm:h-5 sm:w-5" />
              Coda Download
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {config && (
                <>
                  {activeItems.length} attivi • {pendingItems.length} in coda
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {(activeItems.length > 0 || pendingItems.length > 0) && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopAllDialog(true)}
                className="w-full sm:w-auto"
              >
                <StopCircle className="h-4 w-4 mr-2" />
                Ferma Tutti
              </Button>
            )}
            {(completedItems.length > 0 || failedItems.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCompleted}
                className="w-full sm:w-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Pulisci
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-2 sm:p-3">
            <p className="text-xs sm:text-sm text-red-800 dark:text-red-200 break-words">{error}</p>
          </div>
        )}

        {/* Queue Items */}
        {items.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-muted-foreground">
            <Download className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm sm:text-base">Nessun download in coda</p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3 max-h-[400px] sm:max-h-[600px] overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className="border rounded-lg p-2 sm:p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(item.status)}
                      <h4 className="font-medium text-xs sm:text-sm truncate">
                        {item.seriesTitle}
                      </h4>
                    </div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                      S{item.seasonNumber}E{item.episodeNumber} - {item.episodeTitle}
                    </p>
                  </div>
                  {(item.status === "pending" || item.status === "downloading") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(item.id)}
                      title={item.status === "downloading" ? "Annulla download" : "Rimuovi dalla coda"}
                      className={`h-7 w-7 sm:h-8 sm:w-8 ${item.status === "downloading" ? "text-red-600 hover:text-red-700 hover:bg-red-50" : ""}`}
                    >
                      {item.status === "downloading" ? (
                        <StopCircle className="h-3 w-3 sm:h-4 sm:w-4" />
                      ) : (
                        <X className="h-3 w-3 sm:h-4 sm:w-4" />
                      )}
                    </Button>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] sm:text-xs">
                    <span className="text-muted-foreground">
                      {getStatusText(item.status)}
                    </span>
                    <div className="flex items-center gap-1 sm:gap-2">
                      {item.status === "downloading" && item.downloadSpeed && (
                        <span className="text-muted-foreground">
                          {formatSpeed(item.downloadSpeed)}
                        </span>
                      )}
                      {item.status === "downloading" && (
                        <span className="font-medium">{item.progress}%</span>
                      )}
                    </div>
                  </div>
                  {(item.status === "downloading" || item.status === "completed") && (
                    <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                      <div 
                        className="bg-blue-500 h-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                  {item.error && (
                    <p className="text-[10px] sm:text-xs text-red-600 dark:text-red-400 break-words">{item.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!itemToCancel} onOpenChange={() => setItemToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annullare il download?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToCancel && (
                <>
                  Vuoi davvero annullare il download di <strong>{itemToCancel.seriesTitle}</strong> S{itemToCancel.seasonNumber}E{itemToCancel.episodeNumber}?
                  <br /><br />
                  I file parziali già scaricati verranno eliminati.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelDownload} className="bg-red-600 hover:bg-red-700">
              Interrompi Download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stop All Confirmation Dialog */}
      <AlertDialog open={showStopAllDialog} onOpenChange={setShowStopAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fermare tutti i download?</AlertDialogTitle>
            <AlertDialogDescription>
              Verranno rimossi <strong>{activeItems.length + pendingItems.length}</strong> download dalla coda.
              <br />
              Vuoi procedere?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleStopAll} className="bg-red-600 hover:bg-red-700">
              Ferma Tutti
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

