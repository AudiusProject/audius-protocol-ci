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


import { UserReplicaSet } from './user-replica-set';
import { VersionMetadata } from './version-metadata';

/**
 * 
 * @export
 * @interface UsersByContentNode
 */
export interface UsersByContentNode {
    /**
     * 
     * @type {number}
     * @memberof UsersByContentNode
     */
    'latest_chain_block': number;
    /**
     * 
     * @type {number}
     * @memberof UsersByContentNode
     */
    'latest_indexed_block': number;
    /**
     * 
     * @type {number}
     * @memberof UsersByContentNode
     */
    'latest_chain_slot_plays': number;
    /**
     * 
     * @type {number}
     * @memberof UsersByContentNode
     */
    'latest_indexed_slot_plays': number;
    /**
     * 
     * @type {string}
     * @memberof UsersByContentNode
     */
    'signature': string;
    /**
     * 
     * @type {string}
     * @memberof UsersByContentNode
     */
    'timestamp': string;
    /**
     * 
     * @type {VersionMetadata}
     * @memberof UsersByContentNode
     */
    'version': VersionMetadata;
    /**
     * 
     * @type {Array<UserReplicaSet>}
     * @memberof UsersByContentNode
     */
    'data'?: Array<UserReplicaSet>;
}

