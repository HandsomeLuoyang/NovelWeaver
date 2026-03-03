
import { db } from '../db';
import { Book, StoryNode } from '../types';

interface ContentBackup {
    books: Book[];
    nodes: StoryNode[];
}

const API_Endpoint = '/api/storage/content';
const LOCAL_STORAGE_KEY = 'novelweaver-content-backup';

const readLocalBackup = (): ContentBackup | null => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;

    try {
        return JSON.parse(raw) as ContentBackup;
    } catch (error) {
        console.error('Failed to parse local content backup:', error);
        return null;
    }
};

export const PersistenceService = {
    /**
     * Loads content from local file and populates Dexie DB if DB is empty.
     * Can be forced to overwrite if needed (e.g. valid backup found).
     */
    async loadFromDisk(force = false) {
        try {
            // 1. Check if DB has data
            const bookCount = await db.books.count();
            if (!force && bookCount > 0) {
                console.log('DB not empty, skipping load from disk.');
                return;
            }

            // 2. Fetch from disk API, fallback to localStorage
            let data: ContentBackup | null = null;

            try {
                const res = await fetch(API_Endpoint);
                if (res.ok) {
                    data = await res.json();
                    if (typeof window !== 'undefined') {
                        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
                    }
                }
            } catch (error) {
                console.error('Failed to load content from API, trying local backup.', error);
            }

            if (!data) {
                data = readLocalBackup();
            }

            if (!data) return;

            // 3. Import to Dexie
            await db.transaction('rw', db.books, db.nodes, async () => {
                if (force) {
                    await db.books.clear();
                    await db.nodes.clear();
                }
                await db.books.bulkAdd(data.books);
                await db.nodes.bulkAdd(data.nodes);
            });
            console.log('Content loaded from disk successfully.');
        } catch (err) {
            console.error('Persistence load error:', err);
        }
    },

    /**
     * Saves current Dexie DB content to local file.
     * Should be debounced.
     */
    async saveToDisk() {
        try {
            const books = await db.books.toArray();
            const nodes = await db.nodes.toArray();

            const payload: ContentBackup = { books, nodes };

            if (typeof window !== 'undefined') {
                window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
            }

            try {
                await fetch(API_Endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (error) {
                console.error('Failed to save content via API, local backup kept.', error);
            }
            console.log('Content saved to disk.');
        } catch (err) {
            console.error('Persistence save error:', err);
        }
    }
};
