/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class JsonTest {

    @Test
    void escapesEverythingThatWouldBreakAPayload() {
        StringBuilder out = new StringBuilder();
        Json.writeString(out, "line\nbreak \"quoted\" back\\slash tab\there");

        assertThat(out).hasToString("\"line\\nbreak \\\"quoted\\\" back\\\\slash tab\\there\"");
        // A job name containing a quote must not be able to inject JSON.
        assertThat(Json.parse(out.toString())).isEqualTo("line\nbreak \"quoted\" back\\slash tab\there");
    }

    @Test
    void escapesControlCharacters() {
        StringBuilder out = new StringBuilder();
        Json.writeString(out, "bell\u0007null\u0000");
        assertThat(out).hasToString("\"bell\\u0007null\\u0000\"");
    }

    @Test
    void parsesTheSyncResponseShape() {
        Object parsed = Json.parse("""
                {"checks":[
                  {"key":"com.acme.Job#run","id":"abc","pingKey":"11111111-2222-4333-8444-555555555555",
                   "pingUrl":"https://silencewatch.com/p/11111111-2222-4333-8444-555555555555","created":true}
                ],"orphaned":["com.acme.Old#run"]}
                """);

        Map<String, Object> root = Json.asMap(parsed);
        List<Object> checks = Json.asList(root.get("checks"));
        assertThat(checks).hasSize(1);
        assertThat(Json.asString(Json.asMap(checks.get(0)).get("key"))).isEqualTo("com.acme.Job#run");
        assertThat(Json.asString(Json.asMap(checks.get(0)).get("pingKey")))
                .isEqualTo("11111111-2222-4333-8444-555555555555");
        assertThat(Json.asList(root.get("orphaned"))).containsExactly("com.acme.Old#run");
    }

    @Test
    void parsesScalarsAndNesting() {
        assertThat(Json.parse("{\"a\":[1,2.5,-3e2],\"b\":{\"c\":true,\"d\":null},\"e\":\"\\u00e9t\\u00e9\"}"))
                .isEqualTo(Map.of(
                        "a", List.of(1.0, 2.5, -300.0),
                        "b", java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>() {{
                            put("c", Boolean.TRUE);
                            put("d", null);
                        }}),
                        "e", "été"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        "{",
        "{\"a\":}",
        "{\"a\" 1}",
        "[1,]",
        "\"unterminated",
        "{\"a\":1}trailing",
        "nope",
        "{\"a\":\"\\q\"}",
    })
    void rejectsMalformedInput(String input) {
        assertThatThrownBy(() -> Json.parse(input)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesToRecurseIntoAHostileDocument() {
        String deep = "[".repeat(200) + "]".repeat(200);
        assertThatThrownBy(() -> Json.parse(deep))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("nesting too deep");
    }

    @Test
    void accessorsAreForgivingWhenTheShapeIsWrong() {
        // A proxy returning an HTML error page must not become an exception in
        // application code.
        assertThat(Json.asList("not a list")).isEmpty();
        assertThat(Json.asMap(42.0)).isEmpty();
        assertThat(Json.asString(List.of())).isNull();
    }
}
