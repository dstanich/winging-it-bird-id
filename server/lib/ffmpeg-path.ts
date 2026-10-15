/**
 * Path to the ffmpeg binary bundled by ffmpeg-static.
 */

import ffmpegStatic from 'ffmpeg-static';

// ffmpeg-static is CommonJS (module.exports = path) but its types declare an ES
// default export, so under nodenext TS sees the module object rather than the string.
export const FFMPEG_PATH = ffmpegStatic as unknown as string;
