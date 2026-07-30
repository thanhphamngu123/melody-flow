const yts = require('yt-search');

export default async function handler(req, res) {
    // 1. Cấu hình CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const query = req.query.q || req.query.query;

    if (!query) {
        return res.status(400).json({ error: 'Thiếu tham số q (từ khóa tìm kiếm)' });
    }

    try {
        const r = await yts(query);
        
        const videos = r.videos.slice(0, 10).map(v => ({
            id: v.videoId,
            title: v.title,
            thumbnail: v.thumbnail,
            duration: v.timestamp,
            author: v.author.name
        }));

        return res.status(200).json(videos);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
    }
}
