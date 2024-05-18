import _ from 'lodash';

export default {

    prefix: '/nai/v1',

    get: {
        '/models': async () => {
            return {
                "data": [
                    {
                        "id": "deepseek-chat",
                        "object": "model",
                        "owned_by": "deepseek-free-api"
                    },
                    {
                        "id": "deepseek-coder",
                        "object": "model",
                        "owned_by": "deepseek-free-api"
                    }
                ]
            };
        }

    }
}
