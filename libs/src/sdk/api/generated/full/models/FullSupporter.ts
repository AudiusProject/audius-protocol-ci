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
    UserFull,
    UserFullFromJSON,
    UserFullFromJSONTyped,
    UserFullToJSON,
} from './UserFull';

/**
 * 
 * @export
 * @interface FullSupporter
 */
export interface FullSupporter 
    {
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


