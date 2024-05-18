import process from 'process';
import path from 'path';
import { spawn } from 'child_process';

import fs from 'fs-extra';
import { format as dateFormat } from 'date-fns';
import 'colors';

const CRASH_RESTART_LIMIT = 600;
const CRASH_RESTART_DELAY = 5000;
const LOG_PATH = path.resolve("./logs/daemon.log");
let crashCount = 0;
let currentProcess;


function daemonLog(value, color?: string) {
    try {
        const head = `[daemon][${dateFormat(new Date(), "yyyy-MM-dd HH:mm:ss.SSS")}] `;
        value = head + value;
        console.log(color ? value[color] : value);
        fs.ensureDirSync(path.dirname(LOG_PATH));
        fs.appendFileSync(LOG_PATH, value + "\n");
    }
    catch(err) {
        console.error("daemon log write error:", err);
    }
}

daemonLog(`daemon pid: ${process.pid}`);

function createProcess() {
    const childProcess = spawn("node", ["index.js", ...process.argv.slice(2)]);
    childProcess.stdout.pipe(process.stdout, { end: false });
    childProcess.stderr.pipe(process.stderr, { end: false });
    currentProcess = childProcess;
    daemonLog(`process(${childProcess.pid}) has started`);
    childProcess.on("error", err => daemonLog(`process(${childProcess.pid}) error: ${err.stack}`, "red"));
    childProcess.on("close", code => {
        if(code === 0)
            daemonLog(`process(${childProcess.pid}) has exited`);
        else if(code === 2)
            daemonLog(`process(${childProcess.pid}) has been killed!`, "bgYellow");
        else if(code === 3) {
            daemonLog(`process(${childProcess.pid}) has restart`, "yellow");
            createProcess();
        }
        else {
            if(crashCount++ < CRASH_RESTART_LIMIT) {
                daemonLog(`process(${childProcess.pid}) has crashed! delay ${CRASH_RESTART_DELAY}ms try restarting...(${crashCount})`, "bgRed");
                setTimeout(() => createProcess(), CRASH_RESTART_DELAY);
            }
            else
                daemonLog(`process(${childProcess.pid}) has crashed! unable to restart`, "bgRed");
        }
    });
}

process.on("exit", code => {
    if(code === 0)
        daemonLog("daemon process exited");
    else if(code === 2)
        daemonLog("daemon process has been killed!");
});

process.on("SIGTERM", () => {
    daemonLog("received kill signal", "yellow");
    currentProcess && currentProcess.kill("SIGINT");
    process.exit(2);
});

process.on("SIGINT", () => {
    currentProcess && currentProcess.kill("SIGINT");
    process.exit(0);
});

createProcess();
