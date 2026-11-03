package com.vexon.campus

import com.vexon.campus.core.PasswordRule
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PasswordRuleTest {
    @Test
    fun aStrongPasswordPasses() {
        assertNull(PasswordRule.problem("Campus@123"))
        assertNull(PasswordRule.problem("aB3\$efgh"))
    }

    @Test
    fun everyMissingPartIsRefused() {
        for (weak in listOf("Ab1\$", "campus@123", "CAMPUS@123", "Campus@abc", "Campus1234", "Campus 123", "A".repeat(70) + "a1\$")) {
            assertNotNull(weak, PasswordRule.problem(weak))
        }
    }
}
