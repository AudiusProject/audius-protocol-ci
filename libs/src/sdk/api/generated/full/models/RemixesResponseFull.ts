// @ts-nocheck
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

import {
    RemixesResponse,
    RemixesResponseFromJSON,
    RemixesResponseFromJSONTyped,
    RemixesResponseToJSON,
} from './RemixesResponse';
import {
    VersionMetadata,
    VersionMetadataFromJSON,
    VersionMetadataFromJSONTyped,
    VersionMetadataToJSON,
} from './VersionMetadata';

/**
 * 
 * @export
 * @interface RemixesResponseFull
 */
export interface RemixesResponseFull 
    {
        /**
        * 
        * @type {number}
        * @memberof RemixesResponseFull
        */
        latest_chain_block: number;
        /**
        * 
        * @type {number}
        * @memberof RemixesResponseFull
        */
        latest_indexed_block: number;
        /**
        * 
        * @type {number}
        * @memberof RemixesResponseFull
        */
        latest_chain_slot_plays: number;
        /**
        * 
        * @type {number}
        * @memberof RemixesResponseFull
        */
        latest_indexed_slot_plays: number;
        /**
        * 
        * @type {string}
        * @memberof RemixesResponseFull
        */
        signature: string;
        /**
        * 
        * @type {string}
        * @memberof RemixesResponseFull
        */
        timestamp: string;
        /**
        * 
        * @type {VersionMetadata}
        * @memberof RemixesResponseFull
        */
        version: VersionMetadata;
        /**
        * 
        * @type {RemixesResponse}
        * @memberof RemixesResponseFull
        */
        data?: RemixesResponse;
    }


