"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2, ChevronLeft, ChevronRight, Film as FilmIcon, Trash2, Edit, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, RefreshCw } from "lucide-react";
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
import { fetchFilms, deleteFilm, updateFilm, syncFilmMetadata, fetchConfigs, type Film, type PaginationMeta } from "@/lib/api";

const languageLabels: Record<string, string> = {
  dub: "Doppiato",
  sub: "Sottotitolato",
  dub_fallback_sub: "Doppiato (fallback su sub)",
};

const languageBadge = (lang?: string): string => {
  switch (lang) {
    case "dub":
      return "DUB";
    case "dub_fallback_sub":
      return "DUB/SUB";
    default:
      return "SUB";
  }
};
import { debounce } from "lodash";
import { toast } from "sonner";

export default function FilmsPage() {
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [filmIdToDelete, setFilmIdToDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<string>("title");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [onlyMissingLinks, setOnlyMissingLinks] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [filmToEdit, setFilmToEdit] = useState<Film | null>(null);
  const [editFormData, setEditFormData] = useState({
    preferredLanguage: "sub",
    animeworldUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [animeworldBaseUrl, setAnimeworldBaseUrl] = useState("https://www.animeworld.ac");

  useEffect(() => {
    fetchConfigs().then((configs) => {
      const url = configs.animeworld_base_url || "https://www.animeworld.ac";
      setAnimeworldBaseUrl(url.replace(/^\/+|\/+$/g, ''));
    }).catch(() => {});
  }, []);
  const [limit, setLimit] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('filmsPageLimit');
      return saved ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('filmsPageLimit', limit.toString());
    }
  }, [limit]);

  const handleLimitChange = (value: string) => {
    setLimit(parseInt(value, 10));
    setPage(1);
  };

  const fetchFilmsList = async () => {
    setLoading(true);
    try {
      const data = await fetchFilms({ page, limit, search, sortBy, sortOrder, onlyMissingLinks });
      setFilms(data.data);
      setMeta(data.meta);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      toast.error("Errore nel caricamento dei film");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilmsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, sortBy, sortOrder, limit, onlyMissingLinks]);

  const debouncedSearch = useRef(
    debounce((searchValue: string) => {
      setSearch(searchValue);
      setPage(1);
    }, 500)
  ).current;

  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    debouncedSearch(value);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    debouncedSearch.cancel();
    setSearch(searchInput);
    setPage(1);
  };

  const handleEditClick = (film: Film, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilmToEdit(film);
    setEditFormData({
      preferredLanguage: film.preferredLanguage || "sub",
      animeworldUrl: film.animeworldUrl || "",
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (filmId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilmIdToDelete(filmId);
    setDeleteDialogOpen(true);
  };

  const handleSyncClick = async (filmId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncingId(filmId);
    try {
      await syncFilmMetadata(filmId);
      toast.success("Metadati sincronizzati");
      await fetchFilmsList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore durante la sincronizzazione");
    } finally {
      setSyncingId(null);
    }
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-3 w-3 sm:h-4 sm:w-4 ml-1 opacity-30" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3 w-3 sm:h-4 sm:w-4 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 sm:h-4 sm:w-4 ml-1" />
    );
  };

  const handleSaveEdit = async () => {
    if (!filmToEdit) return;

    setSaving(true);
    try {
      await updateFilm(filmToEdit.id, editFormData);
      toast.success("Film aggiornato con successo");
      await fetchFilmsList();
      setEditDialogOpen(false);
      setFilmToEdit(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore durante l'aggiornamento");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!filmIdToDelete) return;

    setDeleting(true);
    try {
      await deleteFilm(filmIdToDelete);
      toast.success("Film eliminato con successo");
      await fetchFilmsList();
      setDeleteDialogOpen(false);
      setFilmIdToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore durante l'eliminazione");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && films.length === 0) {
    return (
      <div className="w-full">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">Lista Film</h1>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">Lista Film</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestisci e monitora i tuoi film anime
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-4 sm:mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <div className="relative flex-1 sm:max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  value={searchInput}
                  onChange={handleSearchInputChange}
                  placeholder="Cerca per titolo..."
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={loading} className="flex-1 sm:flex-initial">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cerca"}
                </Button>
                {search && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setSearchInput("");
                      setPage(1);
                    }}
                    className="flex-1 sm:flex-initial"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="missing-links"
                checked={onlyMissingLinks}
                onCheckedChange={(checked) => {
                  setOnlyMissingLinks(checked);
                  setPage(1);
                }}
              />
              <Label htmlFor="missing-links" className="text-sm cursor-pointer whitespace-nowrap">
                Solo link mancanti
              </Label>
            </div>
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}



      {/* Table */}
      <div className="border rounded-lg bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px] sm:w-[40%]">
                <button
                  onClick={() => handleSort("title")}
                  className="flex items-center hover:text-foreground transition-colors text-xs sm:text-sm font-medium"
                >
                  Titolo
                  {getSortIcon("title")}
                </button>
              </TableHead>
              <TableHead className="hidden sm:table-cell">
                <button
                  onClick={() => handleSort("year")}
                  className="flex items-center hover:text-foreground transition-colors text-xs sm:text-sm font-medium"
                >
                  Anno
                  {getSortIcon("year")}
                </button>
              </TableHead>
              <TableHead className="hidden sm:table-cell">
                <button
                  onClick={() => handleSort("status")}
                  className="flex items-center hover:text-foreground transition-colors text-xs sm:text-sm font-medium"
                >
                  Stato
                  {getSortIcon("status")}
                </button>
              </TableHead>
              <TableHead className="hidden sm:table-cell text-xs sm:text-sm">Lingua</TableHead>
              <TableHead className="text-xs sm:text-sm">AnimeWorld</TableHead>
              <TableHead className="text-right text-xs sm:text-sm">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {films.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <FilmIcon className="h-8 w-8 mb-2" />
                    <p className="font-medium">Nessun film trovato</p>
                    <p className="text-sm mt-1">
                      {search
                        ? "Prova con un termine di ricerca diverso"
                        : "I film appariranno qui quando verranno sincronizzati da Radarr"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              films.map((film) => (
                <TableRow key={film.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm sm:text-base">{film.title}</span>
                        {!film.animeworldUrl && (
                          <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                            Link mancante
                          </Badge>
                        )}
                      </div>
                      <span className="sm:hidden text-xs text-muted-foreground">
                        {film.year || ""}{film.year && film.status ? " · " : ""}{film.status}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{film.year || "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full ${
                        film.status === "ongoing"
                          ? "bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-300"
                          : film.status === "completed"
                          ? "bg-muted text-muted-foreground"
                          : "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300"
                      }`}
                    >
                      {film.status}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">{languageBadge(film.preferredLanguage)}</Badge>
                  </TableCell>
                  <TableCell>
                    {film.animeworldUrl ? (
                      <a
                        href={`${animeworldBaseUrl}/play/${film.animeworldUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Link <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 sm:gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => handleSyncClick(film.id, e)}
                        disabled={syncingId === film.id}
                        title="Sincronizza metadati da Radarr e ricerca link AnimeWorld"
                      >
                        {syncingId === film.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => handleEditClick(film, e)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => handleDeleteClick(film.id, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1">
          {meta && meta.lastPage > 1 && `Pagina ${meta.currentPage} di ${meta.lastPage} (${meta.total} totali)`}
        </div>
        <div className="flex gap-2 order-1 sm:order-2">
          {meta && meta.lastPage > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
            >
              <ChevronLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Precedente</span>
            </Button>
          )}
          <Select value={limit.toString()} onValueChange={handleLimitChange}>
            <SelectTrigger className="w-[70px] h-8 text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          {meta && meta.lastPage > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!meta.hasMorePages || loading}
            >
              <span className="hidden sm:inline">Successiva</span>
              <ChevronRight className="h-4 w-4 sm:ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica Film</DialogTitle>
            <DialogDescription>
              {filmToEdit?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preferredLanguage">Lingua preferita</Label>
              <Select
                value={editFormData.preferredLanguage}
                onValueChange={(value) =>
                  setEditFormData((prev) => ({ ...prev, preferredLanguage: value }))
                }
              >
                <SelectTrigger id="preferredLanguage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(languageLabels).map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="animeworldUrl">Link AnimeWorld</Label>
              <Input
                id="animeworldUrl"
                value={editFormData.animeworldUrl}
                onChange={(e) =>
                  setEditFormData((prev) => ({ ...prev, animeworldUrl: e.target.value }))
                }
                placeholder="https://www.animeworld.so/play/..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
              Annulla
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione eliminerà definitivamente il film dal database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
