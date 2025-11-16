const axios = require("axios");
const NodeCache = require("node-cache");
const { cmd } = require("../command"); 

// Sinhalasub API Settings (ඔබ ලබා දුන් දත්ත)
const API_KEY = "c56182a993f60b4f49cf97ab09886d17"; 
const BASE = "https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub";

// Endpoints
const SEARCH_ENDPOINT = `${BASE}/search`;
const INFO_DL_ENDPOINT = `${BASE}/infodl`; // Movies/General Info/DL සඳහා
const TV_DL_ENDPOINT = `${BASE}/tv/dl`;     // TV Episodes DL සඳහා

module.exports = (conn) => {
  const cache = new NodeCache({ stdTTL: 180 });
  const waitReply = new Map();

  // ─────── SEARCH COMMAND ──────────────────────────────────────────────
  cmd({
    pattern: "sinhalasub",
    desc: "Sinhalasub චිත්‍රපට / ටීවී සෙවීම",
    react: "🍿",
    category: "Movie",
    filename: __filename
  }, async (client, quoted, msg, { from, q }) => {

    if (!q) return client.sendMessage(from, { text: "භාවිතය: .sinhalasub <චිත්‍රපට/ටීවී නම>" }, { quoted: msg });

    try {
      const key = "sinhalasub_search_" + q.toLowerCase();
      let data = cache.get(key);

      if (!data) {
        // API Call for Search 
        const r = await axios.get(`${SEARCH_ENDPOINT}?apiKey=${API_KEY}&q=${encodeURIComponent(q)}`, { timeout: 120000 });
        
        // API ප්‍රතිඵලයේ "data" array එක පරීක්ෂා කිරීම
        if (!r.data?.data?.length) throw new Error("❌ Sinhalasub වෙතින් කිසිවක් සොයා ගැනීමට නොහැක.");

        data = r.data.data;
        cache.set(key, data);
      }

      let caption = `*🍿 Sinhalasub සෙවුම් ප්‍රතිඵල*\n\n`;
      data.slice(0, 10).forEach((m, i) => { // Top 10 results only
        caption += `${i + 1}. *${m.title}* (${m.year || 'N/A'}) ⭐ ${m.rating || 'N/A'}\n\n`;
      });
      caption += `විස්තර ලබා ගැනීමට ඉහත ලැයිස්තුවෙන් අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

      const sent = await client.sendMessage(from, {
        image: { url: data[0].imageUrl || 'https://via.placeholder.com/300x450?text=Sinhalasub+Movie' }, 
        caption
      }, { quoted: msg });

      waitReply.set(from, {
        step: "select_content",
        list: data.slice(0, 10),
        msgId: sent.key.id
      });

    } catch (e) {
      return client.sendMessage(from, { text: "❌ සෙවුම් දෝෂය: " + e.message }, { quoted: msg });
    }
  });


  // ─────── GLOBAL REPLY DETECTOR ───────────────────────────────────────
  conn.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

    const selected = waitReply.get(from);
    if (!selected) return;

    const isReply = contextInfo?.stanzaId === selected.msgId;

    if (!isReply) return; 

    const num = parseInt(text.trim());
    if (isNaN(num)) return; 

    await conn.sendMessage(from, { react: { text: "🔍", key: m.key } });

    // ─── STEP 1 : USER SELECTED CONTENT (Movie/TV) ───────────────
    if (selected.step === "select_content") {
      const content = selected.list[num - 1];
      if (!content) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);

      try {
        const link = content.link;
        let detailsEndpoint = INFO_DL_ENDPOINT; // Default to Movie/General
        let details;

        // Get Details/Download Info (INFO_DL_ENDPOINT)
        const r = await axios.get(`${detailsEndpoint}?apiKey=${API_KEY}&q=${encodeURIComponent(link)}`, { timeout: 120000 });
        details = r.data.data; // Note: Sinhalasub details return under 'data' key

        if (!details || (!details.movieInfo && !details.episodes)) throw new Error("විස්තර ලබා ගැනීමට නොහැක.");

        const movieInfo = details.movieInfo || {};
        const isTVShow = details.episodes && details.episodes.length > 0;
        
        let detailsCaption = `*🎬 ${movieInfo.title || content.title}*\n\n`;
        detailsCaption += `⭐ *IMDb Rating:* ${movieInfo.ratingValue || content.rating || 'N/A'}\n`;
        detailsCaption += `📅 *Release Year:* ${movieInfo.releaseDate || content.year || 'N/A'}\n`;
        detailsCaption += `⏱️ *Runtime:* ${movieInfo.runtime || 'N/A'}\n`;
        detailsCaption += `🎭 *Genres:* ${(movieInfo.genres || []).join(', ') || 'N/A'}\n`;
        detailsCaption += `📜 *Summary:*\n${(movieInfo.summary || 'N/A').substring(0, 300)}...\n\n`;
        
        const imageUrl = movieInfo.posterUrl || content.imageUrl;

        // Handling TV Show Episodes
        if (isTVShow) {
            detailsCaption += `📺 *Available Episodes:*\n`;
            details.episodes.slice(0, 10).forEach((ep, i) => { // Show max 10 episodes
                 detailsCaption += `${i + 1}. ${ep.episodeTitle} - ${ep.subTitle}\n`;
            });
            detailsCaption += `\n*Episode එක බාගත කිරීමට අංකය සමඟින් Reply කරන්න.*`;

            const sent2 = await client.sendMessage(from, {
              image: { url: imageUrl || 'https://via.placeholder.com/300x450?text=Sinhalasub+Details' },
              caption: detailsCaption
            }, { quoted: m });
            
            // Set the next interaction state to select episode
            waitReply.set(from, {
                step: "select_episode",
                content,
                episodes: details.episodes,
                msgId: sent2.key.id
            });
            
        // Handling Movie Download Links
        } else if (details.downloadLinks && details.downloadLinks.length > 0) {
            const downloadLinks = details.downloadLinks;
            detailsCaption += `📥 *බාගත කිරීමට ගුණාත්මකභාවය තෝරන්න:*\n\n`;
            downloadLinks.forEach((l, i) => {
              detailsCaption += `${i + 1}. *${l.quality}* - ${l.size || 'N/A'}\n\n`;
            });
            detailsCaption += `බාගත කිරීම ආරම්භ කිරීමට අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

            const sent2 = await client.sendMessage(from, {
                image: { url: imageUrl || 'https://via.placeholder.com/300x450?text=Sinhalasub+Details' },
                caption: detailsCaption
            }, { quoted: m });
            
            // Set the next interaction state to select quality
            waitReply.set(from, {
                step: "select_quality",
                content: { title: movieInfo.title || content.title, link: link }, 
                links: downloadLinks,
                msgId: sent2.key.id
            });
        } else {
            await client.sendMessage(from, { text: detailsCaption + "\n\n❌ බාගත කිරීමේ සබැඳි සොයා ගැනීමට නොහැක." }, { quoted: m });
        }
        
        await conn.sendMessage(from, { react: { text: "📜", key: m.key } });

      } catch (err) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        conn.sendMessage(from, { text: "❌ දෝෂය: විස්තර ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
      }
    }
    
    // ─── STEP 2 (Alternate) : USER SELECTED EPISODE ────────────────────
    else if (selected.step === "select_episode") {
      const episode = selected.episodes[num - 1];
      if (!episode) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);

      try {
          // Get Download Links for the Episode using TV_DL_ENDPOINT
          const dl = await axios.get(`${TV_DL_ENDPOINT}?apiKey=${API_KEY}&q=${encodeURIComponent(episode.episodeLink)}`, { timeout: 120000 });
          
          if (!dl.data?.data?.downloadLinks?.length) {
              await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
              return conn.sendMessage(from, { text: "❌ Episode එක සඳහා බාගත කිරීමේ සබැඳි සොයා ගැනීමට නොහැක." });
          }
          
          const downloadLinks = dl.data.data.downloadLinks;

          let caption = `*📺 ${selected.content.title} - ${episode.episodeTitle}*\n\nබාගත කිරීමේ ගුණාත්මකභාවය තෝරන්න:\n\n`;
          downloadLinks.forEach((l, i) => {
            caption += `${i + 1}. *${l.quality}* - ${l.size || 'N/A'}\n\n`;
          });
          caption += `බාගත කිරීම ආරම්භ කිරීමට අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

          const sent3 = await conn.sendMessage(from, {
              caption
          }, { quoted: m });

          // Set the next interaction state for quality selection
          waitReply.set(from, {
              step: "select_quality",
              content: { title: selected.content.title + " - " + episode.episodeTitle, link: episode.episodeLink }, // For final file name
              links: downloadLinks,
              msgId: sent3.key.id
          });

          await conn.sendMessage(from, { react: { text: "📥", key: m.key } });

      } catch (err) {
            await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
            conn.sendMessage(from, { text: "❌ දෝෂය: Episode සබැඳි ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
      }
    }


    // ─── STEP 3 : USER SELECTED QUALITY (Final Download) ──────────────
    else if (selected.step === "select_quality") {
      const link = selected.links[num - 1];
      if (!link) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);
      
      const downloadURL = link.url; // The actual download URL
      const GB = sizeToGB(link.size);

      // Auto handle large file (2.5GB limit)
      if (GB > 2.5) { 
        await conn.sendMessage(from, { react: { text: "⚠️", key: m.key } });
        return conn.sendMessage(from, {
          text: `⚠️ ගොනුව WhatsApp හරහා යැවීමට විශාල වැඩිය. (Size: ${link.size || 'N/A'})\n\nසෘජු බාගත කිරීමේ සබැඳිය (Direct Download link):\n${downloadURL}`
        });
      }

      try {
        await conn.sendMessage(from, { react: { text: "⏳", key: m.key } }); 

        // Send the file as a document
        await conn.sendMessage(from, {
          document: { url: downloadURL },
          mimetype: "video/mp4", // Most files are video/mp4
          fileName: `${selected.content.title} ${link.quality}.mp4`,
          caption: `🎬 ${selected.content.title}\nQuality: ${link.quality}\nSize: ${link.size || 'N/A'}\n\nබාගත කිරීම සාර්ථකයි! ✅`
        });

        await conn.sendMessage(from, { react: { text: "✅", key: m.key } });

      } catch (err) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        conn.sendMessage(from, {
          text: `❌ යැවීම අසාර්ථක විය. (Error: ${err.message})\n\nසෘජු බාගත කිරීමේ සබැඳිය (Direct link):\n${downloadURL}`
        });
      }
    }
  });

};


// ─────── SIZE PARSER ─────────────────────────────────────────────────
function sizeToGB(str) {
  if (!str) return 0;
  let s = str.toUpperCase().replace(",", ".");
  const match = s.match(/(\d+\.?\d*)\s*(GB|MB)/);

  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit === "GB") return value;
  if (unit === "MB") return value / 1024;

  return 0;
}
