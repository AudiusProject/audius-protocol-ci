/* tslint:disable */
/* eslint-disable */
/**
 * API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */


import { SearchModel } from './search-model';
import { VersionMetadata } from './version-metadata';

/**
 * 
 * @export
 * @interface SearchFullResponse
 */
export interface SearchFullResponse {
    /**
     * 
     * @type {number}
     * @memberof SearchFullResponse
     */
    'latest_chain_block': number;
    /**
     * 
     * @type {number}
     * @memberof SearchFullResponse
     */
    'latest_indexed_block': number;
    /**
     * 
     * @type {number}
     * @memberof SearchFullResponse
     */
    'latest_chain_slot_plays': number;
    /**
     * 
     * @type {number}
     * @memberof SearchFullResponse
     */
    'latest_indexed_slot_plays': number;
    /**
     * 
     * @type {string}
     * @memberof SearchFullResponse
     */
    'signature': string;
    /**
     * 
     * @type {string}
     * @memberof SearchFullResponse
     */
    'timestamp': string;
    /**
     * 
     * @type {VersionMetadata}
     * @memberof SearchFullResponse
     */
    'version': VersionMetadata;
    /**
     * 
     * @type {SearchModel}
     * @memberof SearchFullResponse
     */
    'data'?: SearchModel;
}

