import path from 'path';

import fs from 'fs-extra';
import yaml from 'yaml';
import _ from 'lodash';

import environment from '../environment.ts';

const CONFIG_PATH = path.join(path.resolve(), 'configs/', environment.env, "/system.yml");


export class SystemConfig {


    requestLog: boolean;

    tmpDir: string;

    logDir: string;

    logWriteInterval: number;

    logFileExpires: number;

    publicDir: string;

    tmpFileExpires: number;

    requestBody: any;

    debug: boolean;

    constructor(options?: any) {
        const { requestLog, tmpDir, logDir, logWriteInterval, logFileExpires, publicDir, tmpFileExpires, requestBody, debug } = options || {};
        this.requestLog = _.defaultTo(requestLog, false);
        this.tmpDir = _.defaultTo(tmpDir, './tmp');
        this.logDir = _.defaultTo(logDir, './logs');
        this.logWriteInterval = _.defaultTo(logWriteInterval, 200);
        this.logFileExpires = _.defaultTo(logFileExpires, 2626560000);
        this.publicDir = _.defaultTo(publicDir, './public');
        this.tmpFileExpires = _.defaultTo(tmpFileExpires, 86400000);
        this.requestBody = Object.assign(requestBody || {}, {
            enableTypes: ['json', 'form', 'text', 'xml'],
            encoding: 'utf-8',
            formLimit: '100mb',
            jsonLimit: '100mb',
            textLimit: '100mb',
            xmlLimit: '100mb',
            formidable: {
                maxFileSize: '100mb'
            },
            multipart: true,
            parsedMethods: ['POST', 'PUT', 'PATCH']
        });
        this.debug = _.defaultTo(debug, true);
    }

    get rootDirPath() {
        return path.resolve();
    }

    get tmpDirPath() {
        return path.resolve(this.tmpDir);
    }

    get logDirPath() {
        return path.resolve(this.logDir);
    }

    get publicDirPath() {
        return path.resolve(this.publicDir);
    }

    static load() {
        if (!fs.pathExistsSync(CONFIG_PATH)) return new SystemConfig();
        const data = yaml.parse(fs.readFileSync(CONFIG_PATH).toString());
        return new SystemConfig(data);
    }

}

export default SystemConfig.load();
