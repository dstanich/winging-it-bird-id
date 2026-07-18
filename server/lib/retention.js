import * as fs from 'fs';
import * as path from 'path';

const MS_PER_DAY = 86_400_000;

function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseDirInt(name) {
    if (!/^\d+$/.test(name)) return null;
    return parseInt(name, 10);
}

function safeRmdir(dir) {
    try {
        fs.rmdirSync(dir);
    } catch (err) {
        if (err.code !== 'ENOTEMPTY' && err.code !== 'ENOENT') {
            console.warn(`Could not remove directory ${dir}: ${err.message}`);
        }
    }
}

export async function pruneOldData(storage, downloadDir, retentionDays) {
    const now = new Date();
    const cutoffMs = now.getTime() - retentionDays * MS_PER_DAY;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const { clipsDeleted, identificationsDeleted } = storage.pruneClipsBefore(cutoffIso);
    if (clipsDeleted > 0 || identificationsDeleted > 0) {
        console.log(`Pruned ${clipsDeleted} clip(s) and ${identificationsDeleted} identification(s) older than ${cutoffIso}`);
    }

    const { audioIdentificationsDeleted } = storage.pruneAudioIdentificationsBefore(cutoffIso);
    if (audioIdentificationsDeleted > 0) {
        console.log(`Pruned ${audioIdentificationsDeleted} audio identification(s) older than ${cutoffIso}`);
    }

    if (!downloadDir || !fs.existsSync(downloadDir)) {
        return;
    }

    const cutoffDayMs = startOfLocalDay(new Date(cutoffMs));
    let dayDirsRemoved = 0;

    for (const yearName of fs.readdirSync(downloadDir)) {
        const year = parseDirInt(yearName);
        if (year === null) continue;
        const yearDir = path.join(downloadDir, yearName);
        if (!fs.statSync(yearDir).isDirectory()) continue;

        for (const monthName of fs.readdirSync(yearDir)) {
            const month = parseDirInt(monthName);
            if (month === null) continue;
            const monthDir = path.join(yearDir, monthName);
            if (!fs.statSync(monthDir).isDirectory()) continue;

            for (const dayName of fs.readdirSync(monthDir)) {
                const day = parseDirInt(dayName);
                if (day === null) continue;
                const dayDir = path.join(monthDir, dayName);
                if (!fs.statSync(dayDir).isDirectory()) continue;

                const dayMs = new Date(year, month - 1, day).getTime();
                if (dayMs < cutoffDayMs) {
                    fs.rmSync(dayDir, { recursive: true, force: true });
                    dayDirsRemoved++;
                }
            }

            safeRmdir(monthDir);
        }

        safeRmdir(yearDir);
    }

    if (dayDirsRemoved > 0) {
        console.log(`Pruned ${dayDirsRemoved} day-director${dayDirsRemoved === 1 ? 'y' : 'ies'} from ${downloadDir}`);
    }
}
