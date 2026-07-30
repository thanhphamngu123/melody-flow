const yts = require('yt-search');

module.exports = async (req, res) => {
    // Enable CORS for Vercel
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const query = req.query.q || req.query.query;
    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter' });
    }

    try {
        const r = await yts(query);
        const videos = r.videos.slice(0, 5); // Return top 5 results

        // Format to match YouTube Data API response so frontend doesn't need to change much
        const items = videos.map(v => ({
            id: { videoId: v.videoId },
            snippet: {
                title: v.title,
                channelTitle: v.author.name,
                thumbnails: { default: { url: v.thumbnail } }
            }
        }));

        res.status(200).json({ items });
    } catch (error) {
        console.error('yt-search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
};
