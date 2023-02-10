/* tslint:disable */
/* eslint-disable */
// @ts-nocheck
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

import { exists, mapValues } from '../runtime';
import type { SearchModel } from './SearchModel';
import {
    SearchModelFromJSON,
    SearchModelFromJSONTyped,
    SearchModelToJSON,
} from './SearchModel';
import type { VersionMetadata } from './VersionMetadata';
import {
    VersionMetadataFromJSON,
    VersionMetadataFromJSONTyped,
    VersionMetadataToJSON,
} from './VersionMetadata';

/**
 * 
 * @export
 * @interface SearchAutocompleteResponse
 */
export interface SearchAutocompleteResponse {
    /**
     * 
     * @type {number}
     * @memberof SearchAutocompleteResponse
     */
    latestChainBlock: number;
    /**
     * 
     * @type {number}
     * @memberof SearchAutocompleteResponse
     */
    latestIndexedBlock: number;
    /**
     * 
     * @type {number}
     * @memberof SearchAutocompleteResponse
     */
    latestChainSlotPlays: number;
    /**
     * 
     * @type {number}
     * @memberof SearchAutocompleteResponse
     */
    latestIndexedSlotPlays: number;
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

/**
 * Check if a given object implements the SearchAutocompleteResponse interface.
 */
export function instanceOfSearchAutocompleteResponse(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "latestChainBlock" in value;
    isInstance = isInstance && "latestIndexedBlock" in value;
    isInstance = isInstance && "latestChainSlotPlays" in value;
    isInstance = isInstance && "latestIndexedSlotPlays" in value;
    isInstance = isInstance && "signature" in value;
    isInstance = isInstance && "timestamp" in value;
    isInstance = isInstance && "version" in value;

    return isInstance;
}

export function SearchAutocompleteResponseFromJSON(json: any): SearchAutocompleteResponse {
    return SearchAutocompleteResponseFromJSONTyped(json, false);
}

export function SearchAutocompleteResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchAutocompleteResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'latestChainBlock': json['latest_chain_block'],
        'latestIndexedBlock': json['latest_indexed_block'],
        'latestChainSlotPlays': json['latest_chain_slot_plays'],
        'latestIndexedSlotPlays': json['latest_indexed_slot_plays'],
        'signature': json['signature'],
        'timestamp': json['timestamp'],
        'version': VersionMetadataFromJSON(json['version']),
        'data': !exists(json, 'data') ? undefined : SearchModelFromJSON(json['data']),
    };
}

export function SearchAutocompleteResponseToJSON(value?: SearchAutocompleteResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'latest_chain_block': value.latestChainBlock,
        'latest_indexed_block': value.latestIndexedBlock,
        'latest_chain_slot_plays': value.latestChainSlotPlays,
        'latest_indexed_slot_plays': value.latestIndexedSlotPlays,
        'signature': value.signature,
        'timestamp': value.timestamp,
        'version': VersionMetadataToJSON(value.version),
        'data': SearchModelToJSON(value.data),
    };
}

