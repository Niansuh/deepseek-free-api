import serviceConfig from "./configs/service-config.ts";
import systemConfig from "./configs/system-config.ts";

class Config {
    

    service = serviceConfig;
    

    system = systemConfig;

}

export default new Config();
