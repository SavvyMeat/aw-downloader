"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Trash2, RefreshCw, Info, AlertTriangle, CheckCircle, Bug, XCircle } from "lucide-react";
import { fetchLogs, clearLogs, LogLevel, type LogEntry } from "@/lib/api";

// Log level hierarchy for filtering (higher number = more severe)
const LOG_LEVEL_SEVERITY: Record<LogLevel | "all", number> = {
  all: 0,
  [LogLevel.DEBUG]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.SUCCESS]: 3,
  [LogLevel.WARNING]: 3,
  [LogLevel.ERROR]: 4,
};

export function LogsCard() {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<LogLevel>(() => {
    // Load from localStorage on mount
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("logs-filter-level");
      return (saved as LogLevel) || LogLevel.INFO;
    }
    return LogLevel.INFO;
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadLogs = async () => {
    try {
      // Always fetch all logs and filter client-side
      const data = await fetchLogs({ limit: 100 });
      setAllLogs(data.logs);
      setError(null);
    } catch (err) {
      console.error("Error fetching logs:", err);
      setError(err instanceof Error ? err.message : "Errore caricamento log");
    } finally {
      setLoading(false);
    }
  };

  // Filter logs based on severity
  const filteredLogs = allLogs.filter(log => {
    const logSeverity = LOG_LEVEL_SEVERITY[log.level];
    const filterSeverity = LOG_LEVEL_SEVERITY[filterLevel];
    return logSeverity >= filterSeverity;
  });

  useEffect(() => {
    loadLogs();

    if (autoRefresh) {
      const interval = setInterval(loadLogs, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Save filter level to localStorage when it changes
  const handleFilterChange = (value: string) => {
    const newLevel = value as LogLevel;
    setFilterLevel(newLevel);
    if (typeof window !== "undefined") {
      localStorage.setItem("logs-filter-level", newLevel);
    }
  };

  const handleClear = async () => {
    try {
      await clearLogs();
      setAllLogs([]);
    } catch (err) {
      console.error("Errore cancellazione log:", err);
    }
  };

  const getLevelIcon = (level: LogLevel) => {
    switch (level) {
      case LogLevel.ERROR:
        return <XCircle className="h-4 w-4" />;
      case LogLevel.WARNING:
        return <AlertTriangle className="h-4 w-4" />;
      case LogLevel.SUCCESS:
        return <CheckCircle className="h-4 w-4" />;
      case LogLevel.DEBUG:
        return <Bug className="h-4 w-4" />;
      case LogLevel.INFO:
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case LogLevel.ERROR:
        return "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800";
      case LogLevel.WARNING:
        return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800";
      case LogLevel.SUCCESS:
        return "bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800";
      case LogLevel.DEBUG:
        return "bg-muted text-muted-foreground border";
      case LogLevel.INFO:
      default:
        return "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800";
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Activity className="h-4 w-4 sm:h-5 sm:w-5" />
              Log di Sistema
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Log in tempo reale delle operazioni del server
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filterLevel}
              onValueChange={handleFilterChange}
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Filtra livello" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LogLevel.DEBUG}>Debug</SelectItem>
                <SelectItem value={LogLevel.INFO}>Info</SelectItem>
                <SelectItem value={LogLevel.WARNING}>Alert</SelectItem>
                <SelectItem value={LogLevel.ERROR}>Error</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`h-8 w-8 sm:h-9 sm:w-9 ${autoRefresh ? "bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900" : ""}`}
            >
              <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 ${autoRefresh ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="icon" onClick={handleClear} className="h-8 w-8 sm:h-9 sm:w-9">
              <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] sm:h-[400px] w-full rounded-md border p-2 sm:p-4" ref={scrollRef}>
          {loading ? (
            <div className="flex items-center justify-center p-6 sm:p-8 text-muted-foreground text-xs sm:text-sm">
              Caricamento log...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-6 sm:p-8 text-destructive">
              <XCircle className="h-6 w-6 sm:h-8 sm:w-8 mb-2" />
              <p className="font-medium text-sm sm:text-base">Errore di connessione</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{error}</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-4"
                onClick={loadLogs}
              >
                Riprova
              </Button>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center p-6 sm:p-8 text-muted-foreground text-xs sm:text-sm">
              Nessun log disponibile
            </div>
          ) : (
            <div className="space-y-1.5 sm:space-y-2">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 text-xs sm:text-sm border-b pb-1.5 sm:pb-2 last:border-0"
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-[10px] sm:text-xs text-muted-foreground font-mono min-w-[60px] sm:min-w-[70px]">
                      {formatTime(log.timestamp)}
                    </span>
                    <Badge
                      variant="outline"
                      className={`${getLevelColor(log.level)} flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs`}
                    >
                      {getLevelIcon(log.level)}
                      <span className="font-medium uppercase">{log.level}</span>
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">
                      {log.category}
                    </Badge>
                  </div>
                  <span className="flex-1 break-words pl-1 sm:pl-0">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
