/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The smallest JSON codec that does this job correctly.
 *
 * The starter deliberately has no JSON dependency: adding Jackson (or worse,
 * pinning a version of it) to every application that wants monitoring is exactly
 * the kind of transitive-dependency accident this library must not cause. The
 * payloads exchanged with SilenceWatch are small and fully known, so a few
 * hundred lines here buy a zero-dependency agent.
 *
 * Not a general-purpose parser: it is strict, allocation-light, and bounded by
 * the caller (responses are read with a cap before reaching it).
 */
public final class Json {

    private Json() {
    }

    /* --------------------------------------------------------------- writing --- */

    /** Appends a JSON string literal, escaping what must be escaped. */
    public static void writeString(StringBuilder out, String value) {
        out.append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                default -> {
                    if (character < 0x20) {
                        out.append(String.format("\\u%04x", (int) character));
                    } else {
                        out.append(character);
                    }
                }
            }
        }
        out.append('"');
    }

    /* --------------------------------------------------------------- reading --- */

    /**
     * Parses a JSON document into {@link Map}, {@link List}, {@link String},
     * {@link Double}, {@link Boolean} and {@code null}.
     *
     * @throws IllegalArgumentException when the input is not valid JSON
     */
    public static Object parse(String input) {
        Parser parser = new Parser(input);
        parser.skipWhitespace();
        Object value = parser.readValue(0);
        parser.skipWhitespace();
        if (!parser.atEnd()) {
            throw new IllegalArgumentException("trailing content at offset " + parser.position);
        }
        return value;
    }

    /** Convenience accessor: {@code asList(map.get("checks"))}. */
    @SuppressWarnings("unchecked")
    public static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : List.of();
    }

    /** Convenience accessor for object members. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }

    public static String asString(Object value) {
        return value instanceof String text ? text : null;
    }

    private static final class Parser {

        /** Guards against a hostile or corrupt response nesting itself to death. */
        private static final int MAX_DEPTH = 32;

        private final String input;
        private int position;

        private Parser(String input) {
            this.input = input;
        }

        private boolean atEnd() {
            return position >= input.length();
        }

        private void skipWhitespace() {
            while (position < input.length() && Character.isWhitespace(input.charAt(position))) {
                position++;
            }
        }

        private char peek() {
            if (atEnd()) {
                throw new IllegalArgumentException("unexpected end of input");
            }
            return input.charAt(position);
        }

        private void expect(char expected) {
            if (atEnd() || input.charAt(position) != expected) {
                throw new IllegalArgumentException("expected '" + expected + "' at offset " + position);
            }
            position++;
        }

        private Object readValue(int depth) {
            if (depth > MAX_DEPTH) {
                throw new IllegalArgumentException("nesting too deep");
            }
            skipWhitespace();
            return switch (peek()) {
                case '{' -> readObject(depth);
                case '[' -> readArray(depth);
                case '"' -> readString();
                case 't' -> readLiteral("true", Boolean.TRUE);
                case 'f' -> readLiteral("false", Boolean.FALSE);
                case 'n' -> readLiteral("null", null);
                default -> readNumber();
            };
        }

        private Map<String, Object> readObject(int depth) {
            expect('{');
            Map<String, Object> members = new LinkedHashMap<>();
            skipWhitespace();
            if (peek() == '}') {
                position++;
                return members;
            }
            while (true) {
                skipWhitespace();
                String key = readString();
                skipWhitespace();
                expect(':');
                members.put(key, readValue(depth + 1));
                skipWhitespace();
                char next = peek();
                position++;
                if (next == '}') {
                    return members;
                }
                if (next != ',') {
                    throw new IllegalArgumentException("expected ',' or '}' at offset " + (position - 1));
                }
            }
        }

        private List<Object> readArray(int depth) {
            expect('[');
            List<Object> elements = new ArrayList<>();
            skipWhitespace();
            if (peek() == ']') {
                position++;
                return elements;
            }
            while (true) {
                elements.add(readValue(depth + 1));
                skipWhitespace();
                char next = peek();
                position++;
                if (next == ']') {
                    return elements;
                }
                if (next != ',') {
                    throw new IllegalArgumentException("expected ',' or ']' at offset " + (position - 1));
                }
            }
        }

        private String readString() {
            expect('"');
            StringBuilder text = new StringBuilder();
            while (true) {
                if (atEnd()) {
                    throw new IllegalArgumentException("unterminated string");
                }
                char character = input.charAt(position++);
                if (character == '"') {
                    return text.toString();
                }
                if (character != '\\') {
                    text.append(character);
                    continue;
                }
                if (atEnd()) {
                    throw new IllegalArgumentException("unterminated escape");
                }
                char escaped = input.charAt(position++);
                switch (escaped) {
                    case '"' -> text.append('"');
                    case '\\' -> text.append('\\');
                    case '/' -> text.append('/');
                    case 'b' -> text.append('\b');
                    case 'f' -> text.append('\f');
                    case 'n' -> text.append('\n');
                    case 'r' -> text.append('\r');
                    case 't' -> text.append('\t');
                    case 'u' -> {
                        if (position + 4 > input.length()) {
                            throw new IllegalArgumentException("truncated unicode escape");
                        }
                        text.append((char) Integer.parseInt(input.substring(position, position + 4), 16));
                        position += 4;
                    }
                    default -> throw new IllegalArgumentException("invalid escape \\" + escaped);
                }
            }
        }

        private Object readLiteral(String literal, Object value) {
            if (!input.startsWith(literal, position)) {
                throw new IllegalArgumentException("invalid literal at offset " + position);
            }
            position += literal.length();
            return value;
        }

        private Double readNumber() {
            int start = position;
            while (!atEnd() && "+-.eE0123456789".indexOf(input.charAt(position)) >= 0) {
                position++;
            }
            if (start == position) {
                throw new IllegalArgumentException("unexpected character at offset " + position);
            }
            try {
                return Double.valueOf(input.substring(start, position));
            } catch (NumberFormatException cause) {
                throw new IllegalArgumentException("invalid number at offset " + start, cause);
            }
        }
    }
}
