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
    SearchModel,
    SearchModelFromJSON,
    SearchModelFromJSONTyped,
    SearchModelToJSON,
} from './SearchModel';
import {
    VersionMetadata,
    VersionMetadataFromJSON,
    VersionMetadataFromJSONTyped,
    VersionMetadataToJSON,
} from './VersionMetadata';

/**
 * 
 * @export
 * @interface SearchAutocompleteResponse
 */
export interface SearchAutocompleteResponse 
    {
        /**
        * 
        * @type {number}
        * @memberof SearchAutocompleteResponse
        */
        latest_chain_block: number;
        /**
        * 
        * @type {number}
        * @memberof SearchAutocompleteResponse
        */
        latest_indexed_block: number;
        /**
        * 
        * @type {number}
        * @memberof SearchAutocompleteResponse
        */
        latest_chain_slot_plays: number;
        /**
        * 
        * @type {number}
        * @memberof SearchAutocompleteResponse
        */
        latest_indexed_slot_plays: number;
        /**
        * 
        * @type {string}
        * @memberof SearchAutocompleteResponse
        */
        signature: string;
        /**
        * 
        * @type {string}
        * @memberof SearchAutocompleteResponse
        */
        timestamp: string;
        /**
        * 
        * @type {VersionMetadata}
        * @memberof SearchAutocompleteResponse
        */
        version: VersionMetadata;
        /**
        * 
        * @type {SearchModel}
        * @memberof SearchAutocompleteResponse
        */
        data?: SearchModel;
    }


