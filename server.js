const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Global error handlers to prevent network ECONNRESET from crashing the server process
process.on('uncaughtException', (err) => {
    console.error('Handled uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('Handled unhandledRejection:', reason);
});

// Intercept fs.writeFileSync to block ytdl debug file creation
const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (filePath, ...args) {
    if (typeof filePath === 'string' && filePath.endsWith('-player-script.js')) {
        return; // Suppress creating debug file
    }
    return originalWriteFileSync.call(fs, filePath, ...args);
};

let ytdl;
try {
    ytdl = require('@distube/ytdl-core');
} catch (e) {
    console.error('ytdl-core not found');
}

let play;
try {
    play = require('play-dl');
} catch (e) {
    console.error('play-dl not found');
}

const DIR = __dirname;
let lastHeartbeat = Date.now();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function pipeYtdlFallback(videoId, res) {
    if (res.headersSent) return;
    try {
        const stream = ytdl(videoId, { filter: f => f.hasAudio });
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'audio/mp4'
        });
        stream.pipe(res);
        stream.on('error', (err) => {
            console.error('Fallback ytdl stream error:', err.message);
        });
    } catch (e) {
        console.error('Failed fallback stream:', e.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Audio stream failed');
        }
    }
}

function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const urlPath = decodeURIComponent(parsedUrl.pathname);

    // Heartbeat endpoint
    if (urlPath === '/heartbeat') {
        lastHeartbeat = Date.now();
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' });
        res.end('ok');
        return;
    }

    // Save & Read playlists directly from playlists.json in the project folder
    if (urlPath === '/api/data') {
        const jsonPath = path.join(DIR, 'playlists.json');
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                fs.writeFile(jsonPath, body, 'utf-8', (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Failed to save file');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                });
            });
            return;
        }
        if (req.method === 'GET') {
            fs.readFile(jsonPath, 'utf-8', (err, data) => {
                if (err) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(null));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data || 'null');
            });
            return;
        }
    }

    // YouTube Search Proxy Endpoint
    if (urlPath === '/api/search') {
        const query = parsedUrl.query.q;
        if (!query || !play) {
            res.writeHead(400, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Missing query or play-dl not installed' }));
            return;
        }

        play.search(query, { limit: 5 }).then(results => {
            const items = results.map(v => ({
                id: { videoId: v.id },
                snippet: {
                    title: v.title,
                    channelTitle: v.channel?.name || 'Unknown Channel',
                    thumbnails: { default: { url: v.thumbnails[0]?.url || '' } }
                }
            }));
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ items }));
        }).catch(err => {
            res.writeHead(500, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }

    // Audio stream proxy endpoint for 8D Audio processing
    if (urlPath === '/stream') {
        const videoId = parsedUrl.query.v;
        if (!videoId || !ytdl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing video ID or ytdl-core');
            return;
        }

        ytdl.getInfo(videoId).then(info => {
            const formats = info.formats.filter(f => f.hasAudio && f.url);
            const format = formats.find(f => f.container === 'mp4') || formats[0];

            if (!format || !format.url) {
                pipeYtdlFallback(videoId, res);
                return;
            }

            const reqHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.youtube.com/'
            };
            if (req.headers.range) {
                reqHeaders['Range'] = req.headers.range;
            }

            const client = format.url.startsWith('https') ? https : http;
            const proxyReq = client.get(format.url, { headers: reqHeaders }, (streamRes) => {
                if (streamRes.statusCode >= 400) {
                    console.log(`Direct stream returned ${streamRes.statusCode}, using fallback`);
                    pipeYtdlFallback(videoId, res);
                    return;
                }

                const resHeaders = {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': streamRes.headers['content-type'] || 'audio/mp4',
                    'Accept-Ranges': 'bytes'
                };
                if (streamRes.headers['content-length']) resHeaders['Content-Length'] = streamRes.headers['content-length'];
                if (streamRes.headers['content-range']) resHeaders['Content-Range'] = streamRes.headers['content-range'];

                res.writeHead(streamRes.statusCode || 200, resHeaders);
                streamRes.pipe(res);
                streamRes.on('error', (err) => {
                    console.error('Stream response error:', err.message);
                });
            });

            proxyReq.on('error', (err) => {
                console.error('Proxy request network error:', err.message);
                pipeYtdlFallback(videoId, res);
            });
        }).catch(err => {
            console.error('Error fetching ytdl info:', err.message);
            pipeYtdlFallback(videoId, res);
        });
        return;
    }

    // Serve static files
    const filePath = path.join(DIR, urlPath === '/' ? 'index.html' : urlPath);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}


function startServerOnPort(port) {
    const srv = http.createServer(handleRequest);

    srv.listen(port, () => {
        console.log(`MelodyFlow server listening on http://localhost:${port}`);
        require('child_process').exec(`start http://localhost:${port}`);
    });

    srv.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            startServerOnPort(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

startServerOnPort(3000);
