"use client";

import { useState } from "react";
import { Film, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getFilmPosterUrl, getSeriesPosterUrl, type QueueItem } from "@/lib/api";

interface DownloadQueueItemProps {
  item: QueueItem;
  onRemove: (id: string) => void;
}

/** "173,3 / 315,2 MB": both sizes in the unit of the total */
const formatProgressSize = (done: number, total: number): string => {
  const unit = total >= 1024 ** 3 ? { size: 1024 ** 3, name: "GB", digits: 2 } : { size: 1024 ** 2, name: "MB", digits: 1 };
  const format = (bytes: number) => (bytes / unit.size).toFixed(unit.digits).replace(".", ",");
  return `${format(done)} / ${format(total)} ${unit.name}`;
};

const formatSize = (bytes: number): string => {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2).replace(".", ",")} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
};

const formatSpeed = (bytesPerSecond: number): string => {
  const mb = bytesPerSecond / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(2).replace(".", ",")} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
};

const getTitle = (item: QueueItem): string =>
  item.mediaType === "film" ? item.filmTitle : item.seriesTitle;

const getSubtitle = (item: QueueItem): string =>
  item.mediaType === "film"
    ? item.year
      ? `Film · ${item.year}`
      : "Film"
    : `S${item.seasonNumber}E${item.episodeNumber} · ${item.episodeTitle}`;

const getPosterUrl = (item: QueueItem): string =>
  item.mediaType === "film" ? getFilmPosterUrl(item.filmId) : getSeriesPosterUrl(item.seriesId);

/** Poster cached by the backend, with a placeholder when it is missing */
function Poster({ item }: { item: QueueItem }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-[52px] w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Film className="h-4 w-4" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimization
    <img
      src={getPosterUrl(item)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-[52px] w-9 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

/** No vertical padding, so the title row is only as tall as the title */
const BADGE_CLASS = "py-0";

function StatusBadge({ item, importing }: { item: QueueItem; importing: boolean }) {
  if (importing) {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_CLASS} border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300`}
      >
        <Loader2 className="animate-spin" />
        Importazione in {item.mediaType === "film" ? "Radarr" : "Sonarr"}
      </Badge>
    );
  }

  switch (item.status) {
    case "downloading":
      return (
        <Badge
          variant="outline"
          className={`${BADGE_CLASS} border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300`}
        >
          Download
        </Badge>
      );
    case "pending":
      return <Badge variant="secondary" className={BADGE_CLASS}>In coda</Badge>;
    case "completed":
      return (
        <Badge
          variant="outline"
          className={`${BADGE_CLASS} border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300`}
        >
          Completato
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive" className={BADGE_CLASS}>Fallito</Badge>;
  }
}

export default function DownloadQueueItem({ item, onRemove }: DownloadQueueItemProps) {
  const downloading = item.status === "downloading";
  const importing = downloading && item.phase === "importing";
  const canRemove = item.status === "pending" || (downloading && !importing);
  const showProgress = downloading || item.status === "completed";
  const removeLabel = downloading ? "Annulla download" : "Rimuovi dalla coda";

  let details: string | null = null;
  if (importing && item.totalSize) {
    details = `${formatSize(item.totalSize)} scaricati`;
  } else if (downloading && item.totalSize) {
    details = formatProgressSize((item.totalSize * item.progress) / 100, item.totalSize);
    if (item.downloadSpeed !== undefined) {
      details += ` · ${formatSpeed(item.downloadSpeed)}`;
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <Poster item={item} />

        <div className="min-w-0 flex-1">
          {/* On narrow screens the badge goes under the title, so a long badge can't hide it */}
          <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <h4 className="max-w-full truncate text-sm font-medium">{getTitle(item)}</h4>
            <StatusBadge item={item} importing={importing} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{getSubtitle(item)}</p>
          {details && (
            <p className="text-xs text-muted-foreground tabular-nums">{details}</p>
          )}
          {item.error && (
            <p className="mt-1 break-words text-xs text-destructive">{item.error}</p>
          )}
        </div>

        {/* Button at the top, percentage at the bottom on the line of the sizes */}
        <div className="flex shrink-0 flex-col items-end self-stretch">
          {canRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 -mt-1 h-7 w-7 text-muted-foreground"
                  onClick={() => onRemove(item.id)}
                  aria-label={removeLabel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{removeLabel}</TooltipContent>
            </Tooltip>
          )}
          {showProgress && (
            <span className="mt-auto text-sm leading-4 font-medium tabular-nums">
              {item.progress}%
            </span>
          )}
        </div>
      </div>

      {/* Thin bar built into the bottom edge of the item */}
      {showProgress && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-muted">
          <div
            className={cn(
              "h-full transition-[width] duration-500",
              importing || item.status === "completed" ? "bg-green-500" : "bg-blue-500"
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
