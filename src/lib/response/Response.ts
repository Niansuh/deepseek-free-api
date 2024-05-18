import mime from 'mime';
import _ from 'lodash';

import Body from './Body.ts';
import util from '../util.ts';

export interface ResponseOptions {
    statusCode?: number;
    type?: string;
    headers?: Record<string, any>;
    redirect?: string;
    body?: any;
    size?: number;
    time?: number;
}

export default class Response {


    statusCode: number;

    type: string;

    headers: Record<string, any>;

    redirect: string;

    body: any;

    size: number;

    time: number;

    constructor(body: any, options: ResponseOptions = {}) {
        const { statusCode, type, headers, redirect, size, time } = options;
        this.statusCode = Number(_.defaultTo(statusCode, Body.isInstance(body) ? body.statusCode : undefined))
        this.type = type;
        this.headers = headers;
        this.redirect = redirect;
        this.size = size;
        this.time = Number(_.defaultTo(time, util.timestamp()));
        this.body = body;
    }

    injectTo(ctx) {
        this.redirect && ctx.redirect(this.redirect);
        this.statusCode && (ctx.status = this.statusCode);
        this.type && (ctx.type = mime.getType(this.type) || this.type);
        const headers = this.headers || {};
        if(this.size && !headers["Content-Length"] && !headers["content-length"])
            headers["Content-Length"] = this.size;
        ctx.set(headers);
        if(Body.isInstance(this.body))
            ctx.body = this.body.toObject();
        else
            ctx.body = this.body;
    }

    static isInstance(value) {
        return value instanceof Response;
    }

}
