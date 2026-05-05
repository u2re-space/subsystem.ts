import fs from "node:fs/promises"
import path from "node:path"

//
const probeDirectory = async (dirList, agr = "local/", testFile = "rootCA.crt") => {
    for (const dir of dirList) {
        let check = null;
        try {
            check = await fs
                .stat(path.resolve(import.meta.dirname, dir + agr, testFile))
                .catch(() => false);
        } catch(e) {
            console.warn(e);
        }
        if (check) {
            return path.resolve(import.meta.dirname, dir);
        }
    }
    return path.resolve(import.meta.dirname, dirList[0]);
};

//
const probe = await probeDirectory([
    "./",
    "./https/",
    "../https/",
], "local/");

//
const local = await probeDirectory([
    path.resolve(probe, "./private/"),
    path.resolve(probe, "./local/"),
], "");

//
const loadFile = async (lfile)=>{
    const fx = (await fs.readFile(path.resolve(probe, lfile)));
    return new TextDecoder().decode(fx);
}

//
export default {
    ca: await loadFile(path.resolve(local, "./rootCA.crt")),
    key: await loadFile(path.resolve(local, "./multi.key")),
    cert: await loadFile(path.resolve(local, "./multi.crt"))
};
