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


import { TrackFull } from './track-full';
import { VersionMetadata } from './version-metadata';

/**
 * 
 * @export
 * @interface FullTracksResponse
 */
export interface FullTracksResponse {
    /**
     * 
     * @type {number}
     * @memberof FullTracksResponse
     */
    'latest_chain_block': number;
    /**
     * 
     * @type {number}
     * @memberof FullTracksResponse
     */
    'latest_indexed_block': number;
    /**
     * 
     * @type {number}
     * @memberof FullTracksResponse
     */
    'latest_chain_slot_plays': number;
    /**
     * 
     * @type {number}
     * @memberof FullTracksResponse
     */
    'latest_indexed_slot_plays': number;
    /**
     * 
     * @type {string}
     * @memberof FullTracksResponse
     */
    'signature': string;
    /**
     * 
     * @type {string}
     * @memberof FullTracksResponse
     */
    'timestamp': string;
    /**
     * 
     * @type {VersionMetadata}
     * @memberof FullTracksResponse
     */
    'version': VersionMetadata;
    /**
     * 
     * @type {Array<TrackFull>}
     * @memberof FullTracksResponse
     */
    'data'?: Array<TrackFull>;
}

