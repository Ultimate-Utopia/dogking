/**
 * YouTube 網址解析的測試。不需要資料庫。
 *
 *   node scripts/test-youtube.ts
 */
import assert from 'node:assert/strict';
import { parseYouTubeId, youTubeEmbedUrl, youTubeThumbUrl } from '../src/lib/youtube.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log('  ✓', name);
};

const V = 'dQw4w9WgXcQ';

console.log('YouTube 網址');

t('watch 連結', () => assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${V}`), V));
t('分享短網址', () => assert.equal(parseYouTubeId(`https://youtu.be/${V}`), V));
t('直播頁', () => assert.equal(parseYouTubeId(`https://www.youtube.com/live/${V}`), V));
t('Shorts', () => assert.equal(parseYouTubeId(`https://www.youtube.com/shorts/${V}`), V));
t('嵌入網址', () => assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${V}`), V));
t('舊式 /v/ 網址', () => assert.equal(parseYouTubeId(`https://www.youtube.com/v/${V}`), V));
t('nocookie 網域', () => assert.equal(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${V}`), V));

t('後面跟著追蹤參數也可以（手機分享常見）', () => {
	assert.equal(parseYouTubeId(`https://youtu.be/${V}?si=AbCdEfGhIjKlMnOp`), V);
	assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${V}&t=120s&list=PLxxxx`), V);
});

t('沒寫 https:// 也可以', () => assert.equal(parseYouTubeId(`youtu.be/${V}`), V));
t('前後有空白也可以', () => assert.equal(parseYouTubeId(`  https://youtu.be/${V}  `), V));
t('直接貼 11 碼 ID', () => assert.equal(parseYouTubeId(V), V));

console.log('認不出來的情況');

t('空字串', () => assert.equal(parseYouTubeId(''), null));
t('不是網址的字', () => assert.equal(parseYouTubeId('我忘記網址了'), null));
t('別的網站', () => assert.equal(parseYouTubeId('https://www.twitch.tv/shinyuki2511'), null));
t('YouTube 頻道頁不是影片', () => assert.equal(parseYouTubeId('https://www.youtube.com/@YuutaTsubasa'), null));
t('ID 長度不對', () => {
	assert.equal(parseYouTubeId('https://youtu.be/tooshort'), null);
	assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=waaaaaaaytoolong'), null);
});
t('看起來像 YouTube 的別的網域（避免被騙）', () =>
	assert.equal(parseYouTubeId(`https://youtube.com.evil.example/watch?v=${V}`), null));

console.log('組出來的網址');

t('嵌入用 nocookie 網域且自動播放', () => {
	const u = youTubeEmbedUrl(V);
	assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/' + V));
	assert.ok(u.includes('autoplay=1'));
});
t('縮圖網址', () => assert.equal(youTubeThumbUrl(V), `https://i.ytimg.com/vi/${V}/hqdefault.jpg`));

console.log(`\n${passed} 項全部通過`);
