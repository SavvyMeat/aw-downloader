"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchConfigs, updateSeasonDownloadUrls, type Season } from "@/lib/api";
import {
    closestCenter,
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Edit2, Loader2, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SortableLinkItem } from "./sortable-link-item";

interface SeasonCardProps {
    season: Season;
    seriesTitle: string;
    isAbsolute: boolean;
    totalEpisodes?: number;
    totalMissingEpisodes?: number;
    onUpdate?: () => void;
}

export function SeasonCard({
    season,
    seriesTitle,
    isAbsolute,
    totalEpisodes,
    totalMissingEpisodes,
    onUpdate,
}: SeasonCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editUrls, setEditUrls] = useState<Array<{ id: string; value: string }>>([]);
    const [saving, setSaving] = useState(false);
    const [baseUrl, setBaseUrl] = useState("https://www.animeworld.ac");

    const downloadUrls = season.downloadUrls && season.downloadUrls.length > 0
        ? season.downloadUrls
        : [];

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        fetchConfigs().then((configs) => {
            const url = configs.animeworld_base_url || "https://www.animeworld.ac";
            setBaseUrl(url.replace(/^\/+|\/+$/g, ''));
        }).catch(() => {
            // Fallback to default
        });
    }, []);

    const handleEditUrls = () => {
        setIsEditing(true);
        const urls = downloadUrls.length > 0
            ? downloadUrls.map((url, index) => ({
                id: `${season.id}-${index}`,
                value: url,
            }))
            : [];
        setEditUrls(urls);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditUrls([]);
    };

    const handleSaveUrls = async () => {
        setSaving(true);
        try {
            const urlsArray = editUrls
                .map((item) => item.value.trim())
                .filter((url) => url.length > 0);

            await updateSeasonDownloadUrls(season.id, {
                downloadUrls: JSON.stringify(urlsArray)
            });

            setIsEditing(false);
            setEditUrls([]);
            toast.success("Identificatori aggiornati");

            if (onUpdate) {
                onUpdate();
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Errore salvataggio");
        } finally {
            setSaving(false);
        }
    };

    const handleAddLink = () => {
        const newId = `${season.id}-${Date.now()}`;
        setEditUrls([...editUrls, { id: newId, value: "" }]);
    };

    const handleRemoveLink = (id: string) => {
        setEditUrls(editUrls.filter((item) => item.id !== id));
    };

    const handleLinkChange = (id: string, value: string) => {
        // Estrae l'identificatore se viene incollato un URL completo
        let identifier = value.trim();
        
        // Controlla se contiene /play/
        if (identifier.includes('/play/')) {
            const parts = identifier.split('/play/');
            identifier = parts[parts.length - 1];
        }
        
        // Rimuove eventuali protocolli e domini rimasti
        identifier = identifier.replace(/^https?:\/\/[^/]+\/?/, '');
        
        // Estrae solo la parte che finisce con .xxxxx (punto + 5 caratteri alfanumerici)
        // e rimuove tutto quello che viene dopo (es: /episodio-1)
        const match = identifier.match(/^([^/]+\.[a-zA-Z0-9]{5})/);
        if (match) {
            identifier = match[1];
        } else {
            // Se non trova il pattern, rimuove solo eventuali slash finali e parti dopo il primo slash
            identifier = identifier.split('/')[0];
        }
        
        setEditUrls(editUrls.map((item) => 
            item.id === id ? { ...item, value: identifier } : item
        ));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setEditUrls((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const displayEpisodes = isAbsolute ? totalEpisodes : season.totalEpisodes;
    const displayMissing = isAbsolute ? totalMissingEpisodes : season.missingEpisodes;

    return (
        <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg">
                            {isAbsolute ? "Episodi (Numerazione Assoluta)" : `Stagione ${season.seasonNumber}`}
                        </h3>
                        {!!season.deleted && (
                            <Badge variant="secondary">
                                Non presente su Sonarr
                            </Badge>
                        )}
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                        <span>{displayEpisodes} episodi{isAbsolute ? " (totale)" : ""}</span>
                        {displayMissing! > 0 && (
                            <span className="text-red-600 dark:text-red-400 font-medium">
                                {displayMissing} mancanti
                            </span>
                        )}
                    </div>
                </div>

                {!isEditing && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEditUrls}
                    >
                        <Edit2 className="h-3 w-3 mr-2" />
                        Modifica Identificatori
                    </Button>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium">
                                Identificatori Anime
                            </label>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAddLink}
                                className="h-7"
                            >
                                <Plus className="h-3 w-3 mr-1" />
                                Aggiungi
                            </Button>
                        </div>
                        
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                        >
                            <SortableContext
                                items={editUrls.map((item) => item.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                                    {editUrls.length === 0 ? (
                                        <div className="text-sm text-muted-foreground italic text-center py-4 border-2 border-dashed rounded-md">
                                            Nessun identificatore. Clicca "Aggiungi" per iniziare.
                                        </div>
                                    ) : (
                                        editUrls.map((item) => (
                                            <SortableLinkItem
                                                key={item.id}
                                                id={item.id}
                                                value={item.value}
                                                isEditing={true}
                                                baseUrl={baseUrl}
                                                onChange={(value) => handleLinkChange(item.id, value)}
                                                onRemove={() => handleRemoveLink(item.id)}
                                            />
                                        ))
                                    )}
                                </div>
                            </SortableContext>
                        </DndContext>
                        
                        <p className="text-xs text-muted-foreground mt-2">
                            Trascina gli identificatori per riordinarli. Verranno combinati con {baseUrl}/play/ per creare gli URL completi.
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={handleSaveUrls}
                            disabled={saving}
                            size="sm"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                    Salvataggio...
                                </>
                            ) : (
                                <>
                                    <Save className="h-3 w-3 mr-2" />
                                    Salva
                                </>
                            )}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleCancelEdit}
                            disabled={saving}
                            size="sm"
                        >
                            <X className="h-3 w-3 mr-2" />
                            Annulla
                        </Button>
                    </div>
                </div>
            ) : (
                <div>
                    {downloadUrls.length > 0 ? (
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                                Identificatori Anime ({downloadUrls.length}):
                            </p>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                                {downloadUrls.map((url: string, index: number) => (
                                    <SortableLinkItem
                                        key={index}
                                        id={`view-${index}`}
                                        value={url}
                                        isEditing={false}
                                        baseUrl={baseUrl}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">
                            Nessun identificatore configurato
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
