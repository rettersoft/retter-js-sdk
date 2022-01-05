import axios, { AxiosRequestConfig, AxiosInstance, AxiosPromise } from 'axios';
// var HttpsProxyAgent = require('https-proxy-agent');

// const httpsAgent = new HttpsProxyAgent('http://127.0.0.1:9090')

const initialization = (config: AxiosRequestConfig): AxiosInstance => {
    const axiosInstance = axios.create(config);
    
    /*
        Add default headers, interceptors etc..
    */

    return axiosInstance;
};

export default initialization;