import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

const bookmarkRoutes = new Hono<{ Bindings: { DB: D1Database }, Variables: { user: any } }>()

bookmarkRoutes.use('*', authMiddleware)

// 1. GET / - List all bookmarks and folders
bookmarkRoutes.get('/', async (c) => {
    const user = c.get('user')
    const userId = user.id

    try {
        // Fetch folders
        const { results: folders } = await c.env.DB.prepare(
            'SELECT * FROM folders WHERE user_id = ? ORDER BY created_at DESC'
        ).bind(userId).all()

        // Fetch bookmarks
        const { results: bookmarks } = await c.env.DB.prepare(
            'SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC'
        ).bind(userId).all()

        // Organize bookmarks into folders
        const folderMap = new Map()
        folders.forEach((f: any) => {
            folderMap.set(f.id, { ...f, bookmarks: [] })
        })

        const rootBookmarks: any[] = []

        bookmarks.forEach((b: any) => {
            if (b.folder_id && folderMap.has(b.folder_id)) {
                folderMap.get(b.folder_id).bookmarks.push(b)
            } else {
                rootBookmarks.push(b)
            }
        })

        return c.json({
            folders: Array.from(folderMap.values()),
            bookmarks: rootBookmarks // Bookmarks not in any folder (or "Umum" if default)
        })
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 2. POST /folders - Create folder
bookmarkRoutes.post('/folders', async (c) => {
    const user = c.get('user')
    const { name } = await c.req.json()
    const id = crypto.randomUUID()

    try {
        await c.env.DB.prepare(
            'INSERT INTO folders (id, user_id, name) VALUES (?, ?, ?)'
        ).bind(id, user.id, name).run()

        return c.json({ id, name, bookmarks: [] }, 201)
    } catch (e: any) {
        if (e.message.includes('UNIQUE')) {
            return c.json({ error: 'Folder already exists' }, 409)
        }
        return c.json({ error: e.message }, 500)
    }
})

// 3. PUT /folders/:id - Rename folder
bookmarkRoutes.put('/folders/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const { name } = await c.req.json()

    try {
        const res = await c.env.DB.prepare(
            'UPDATE folders SET name = ? WHERE id = ? AND user_id = ?'
        ).bind(name, id, user.id).run()

        if (!res.success) return c.json({ error: 'Update failed' }, 400)
        return c.json({ id, name })
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 4. DELETE /folders/:id - Delete folder
bookmarkRoutes.delete('/folders/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    try {
        // Cascade delete handles bookmarks automatically via schema
        const res = await c.env.DB.prepare(
            'DELETE FROM folders WHERE id = ? AND user_id = ?'
        ).bind(id, user.id).run()

        if (!res.success) return c.json({ error: 'Delete failed' }, 400)
        return c.json({ success: true })
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 5. POST / - Create bookmark
bookmarkRoutes.post('/', async (c) => {
    const user = c.get('user')
    const { surah, ayah, folder_id, label, page, juz, surah_name_ar, surah_name_en } = await c.req.json()
    const id = crypto.randomUUID()
    const key = `${surah}:${ayah}` // Legacy key support or helper

    try {
        await c.env.DB.prepare(
            `INSERT INTO bookmarks (id, user_id, folder_id, surah, ayah, label, key, page, juz, surah_name_ar, surah_name_en) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, folder_id || null, surah, ayah, label || null, key, page || null, juz || null, surah_name_ar || null, surah_name_en || null).run()

        return c.json({ id, surah, ayah, folder_id, label, key, page, juz, surah_name_ar, surah_name_en }, 201)
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 6. DELETE /:id - Delete bookmark
bookmarkRoutes.delete('/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    try {
        await c.env.DB.prepare(
            'DELETE FROM bookmarks WHERE id = ? AND user_id = ?'
        ).bind(id, user.id).run()
        return c.json({ success: true })
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 7. PUT /:id - Update bookmark (Move folder / Label)
bookmarkRoutes.put('/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const { folder_id, label } = await c.req.json()

    // Build query dynamically based on provided fields
    const updates: string[] = []
    const values: any[] = []

    if (folder_id !== undefined) {
        updates.push('folder_id = ?')
        values.push(folder_id)
    }
    if (label !== undefined) {
        updates.push('label = ?')
        values.push(label)
    }

    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400)

    values.push(id, user.id)

    try {
        await c.env.DB.prepare(
            `UPDATE bookmarks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
        ).bind(...values).run()

        return c.json({ id, folder_id, label })
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

export { bookmarkRoutes }
