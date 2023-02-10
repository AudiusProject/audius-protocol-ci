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
import type { UserFull } from './UserFull';
import {
    UserFullFromJSON,
    UserFullFromJSONTyped,
    UserFullToJSON,
} from './UserFull';

/**
 * 
 * @export
 * @interface FullSupporter
 */
export interface FullSupporter {
    /**
     * 
     * @type {number}
     * @memberof FullSupporter
     */
    rank: number;
    /**
     * 
     * @type {string}
     * @memberof FullSupporter
     */
    amount: string;
    /**
     * 
     * @type {UserFull}
     * @memberof FullSupporter
     */
    sender: UserFull;
}

/**
 * Check if a given object implements the FullSupporter interface.
 */
export function instanceOfFullSupporter(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "rank" in value;
    isInstance = isInstance && "amount" in value;
    isInstance = isInstance && "sender" in value;

    return isInstance;
}

export function FullSupporterFromJSON(json: any): FullSupporter {
    return FullSupporterFromJSONTyped(json, false);
}

export function FullSupporterFromJSONTyped(json: any, ignoreDiscriminator: boolean): FullSupporter {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'rank': json['rank'],
        'amount': json['amount'],
        'sender': UserFullFromJSON(json['sender']),
    };
}

export function FullSupporterToJSON(value?: FullSupporter | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'rank': value.rank,
        'amount': value.amount,
        'sender': UserFullToJSON(value.sender),
    };
}

