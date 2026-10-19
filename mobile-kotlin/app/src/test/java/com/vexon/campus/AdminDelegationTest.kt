package com.vexon.campus

import com.vexon.campus.screens.creatableRoles
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/** Create-login: only the roles a Super Admin delegated are offered (the server enforces the same). */
class AdminDelegationTest {
    private val all = listOf("student", "faculty", "hod", "principal")

    @Test
    fun legacyAdminsKeepEveryRole() {
        assertEquals(all, creatableRoles(Json.parseToJsonElement("""{"policyManaged":false,"delegation":null}"""), all))
    }

    @Test
    fun policyManagedAdminsSeeOnlyDelegatedRoles() {
        val res = Json.parseToJsonElement("""{"policyManaged":true,"delegation":{"createRoles":["faculty","student"],"assignRoles":[]}}""")
        assertEquals(listOf("student", "faculty"), creatableRoles(res, all))
    }

    @Test
    fun noDelegatedRolesMeansNone() {
        val res = Json.parseToJsonElement("""{"policyManaged":true,"delegation":{"createRoles":[]}}""")
        assertEquals(emptyList<String>(), creatableRoles(res, all))
    }
}
