"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { checkRadarrHealth, forceRadarrHealthCheck, type RadarrHealthStatus } from "@/lib/api";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function RadarrStatusBadge() {
  const [status, setStatus] = useState<RadarrHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // Initial check
    checkHealth();

    // Check every 2 minutes
    const interval = setInterval(checkHealth, 120000);

    return () => clearInterval(interval);
  }, []);

  const checkHealth = async () => {
    try {
      const result = await checkRadarrHealth();
      setStatus(result);
    } catch (error) {
      console.error("Failed to check Radarr health:", error);
      setStatus({ healthy: false, lastCheck: null });
    } finally {
      setLoading(false);
    }
  };

  const handleForceRefresh = async () => {
    setIsRefreshing(true);
    try {
      const result = await forceRadarrHealthCheck();
      setStatus(result);
      if (result.healthy) {
        toast.success("Radarr è raggiungibile");
      } else {
        toast.error("Radarr non è raggiungibile");
      }
    } catch (error) {
      console.error("Failed to force refresh:", error);
      toast.error("Errore durante il controllo");
    } finally {
      setIsRefreshing(false);
    }
  };

  if (loading) {
    return null;
  }

  if (!status || status.healthy) {
    // Don't show badge if healthy
    return null;
  }

  return (
    <Badge
      variant="destructive"
      className="gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
      title="Clicca per verificare la connessione a Radarr"
      onClick={handleForceRefresh}
    >
      {isRefreshing ? (
        <RefreshCw className="h-3 w-3 animate-spin" />
      ) : (
        <AlertCircle className="h-3 w-3" />
      )}
      <span className="text-xs">Radarr offline</span>
    </Badge>
  );
}
