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
import { Search, Loader2, ChevronLeft, ChevronRight, Film as FilmIcon, Trash2, Edit, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
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
import { fetchFilms, deleteFilm, updateFilm, type Film, type PaginationMeta } from "@/lib/api";
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

      {/* Results Count and Pagination Info */}
      <div className="mb-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {meta && `Mostra ${meta.total} film totali`}
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="limit" className="text-sm whitespace-nowrap">Righe per pagina:</Label>
          <Select value={limit.toString()} onValueChange={handleLimitChange}>
            <SelectTrigger id="limit" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("title")}>
                  <div className="flex items-center">
                    Titolo
                    {getSortIcon("title")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("year")}>
                  <div className="flex items-center">
                    Anno
                    {getSortIcon("year")}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("status")}>
                  <div className="flex items-center">
                    Stato
                    {getSortIcon("status")}
                  </div>
                </TableHead>
                <TableHead>Lingua</TableHead>
                <TableHead>AnimeWorld</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {films.map((film) => (
                <TableRow key={film.id} className="hover:bg-muted/50">
                  <TableCell>
                    <FilmIcon className="h-5 w-5 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="font-medium">{film.title}</TableCell>
                  <TableCell>{film.year || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={
                      film.status === "completed" ? "default" :
                      film.status === "ongoing" ? "secondary" : "outline"
                    }>
                      {film.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {film.preferredLanguage === "sub" ? "SUB" : 
                       film.preferredLanguage === "ita" ? "ITA" : "DUAL"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {film.animeworldUrl ? (
                      <a 
                        href={film.animeworldUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Link <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <Badge variant="destructive">Mancante</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleEditClick(film, e)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleDeleteClick(film.id, e)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {meta && (
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Pagina {meta.currentPage} di {meta.lastPage}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!meta || page === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!meta || !meta.hasMorePages}
            >
              Successiva
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

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
                  <SelectItem value="sub">Sottotitoli (SUB)</SelectItem>
                  <SelectItem value="ita">Italiano (ITA)</SelectItem>
                  <SelectItem value="dual">Dual Audio</SelectItem>
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
