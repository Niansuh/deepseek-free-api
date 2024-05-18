import Exception from './Exception.js';

export default class APIException extends Exception {


    constructor(exception: (string | number)[], errmsg?: string) {
        super(exception, errmsg);
    }

}
