export default {
    SYSTEM_ERROR: [-1000, 'System exception'],
    SYSTEM_REQUEST_VALIDATION_ERROR: [-1001, 'Request parameter verification error'],
    SYSTEM_NOT_ROUTE_MATCHING: [-1002, 'No matching route']
} as Record<string, [number, string]>
