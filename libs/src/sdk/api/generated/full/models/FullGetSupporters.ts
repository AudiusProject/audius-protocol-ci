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
    FullSupporter,
    FullSupporterFromJSON,
    FullSupporterFromJSONTyped,
    FullSupporterToJSON,
} from './FullSupporter';
import {
    VersionMetadata,
    VersionMetadataFromJSON,
    VersionMetadataFromJSONTyped,
    VersionMetadataToJSON,
} from './VersionMetadata';

/**
 * 
 * @export
 * @interface FullGetSupporters
 */
export interface FullGetSupporters 
    {
        /**
        * 
        * @type {number}
        * @memberof FullGetSupporters
        */
        latest_chain_block: number;
        /**
        * 
        * @type {number}
        * @memberof FullGetSupporters
        */
        latest_indexed_block: number;
        /**
        * 
        * @type {number}
        * @memberof FullGetSupporters
        */
        latest_chain_slot_plays: number;
        /**
        * 
        * @type {number}
        * @memberof FullGetSupporters
        */
        latest_indexed_slot_plays: number;
        /**
        * 
        * @type {string}
        * @memberof FullGetSupporters
        */
        signature: string;
        /**
        * 
        * @type {string}
        * @memberof FullGetSupporters
        */
        timestamp: string;
        /**
        * 
        * @type {VersionMetadata}
        * @memberof FullGetSupporters
        */
        version: VersionMetadata;
        /**
        * 
        * @type {Array<FullSupporter>}
        * @memberof FullGetSupporters
        */
        data?: Array<FullSupporter>;
    }


