import assert from 'assert';

import _ from 'lodash';

export default class Exception extends Error {


    errcode: number;

    errmsg: string;

    data: any;

    httpStatusCode: number;


    constructor(exception: (string | number)[], _errmsg?: string) {
        assert(_.isArray(exception), 'Exception must be Array');
        const [errcode, errmsg] = exception as [number, string];
        assert(_.isFinite(errcode), 'Exception errcode invalid');
        assert(_.isString(errmsg), 'Exception errmsg invalid');
        super(_errmsg || errmsg);
        this.errcode = errcode;
        this.errmsg = _errmsg || errmsg;
    }

    compare(exception: (string | number)[]) {
        const [errcode] = exception as [number, string];
        return this.errcode == errcode;
    }

    setHTTPStatusCode(value: number) {
        this.httpStatusCode = value;
        return this;
    }

    setData(value: any) {
        this.data = _.defaultTo(value, null);
        return this;
    }

}
