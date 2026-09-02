package analyzer

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type codeOwnerRule struct {
	pattern *regexp.Regexp
	owner   string
}

func readCodeOwners(root string) []codeOwnerRule {
	var file *os.File
	for _, relative := range []string{filepath.Join(".github", "CODEOWNERS"), "CODEOWNERS", filepath.Join("docs", "CODEOWNERS")} {
		opened, err := os.Open(filepath.Join(root, relative))
		if err == nil {
			file = opened
			break
		}
	}
	if file == nil {
		return nil
	}
	defer file.Close()
	rules := []codeOwnerRule{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || strings.HasPrefix(fields[0], "#") {
			continue
		}
		if pattern := codeOwnerPattern(fields[0]); pattern != nil {
			rules = append(rules, codeOwnerRule{pattern: pattern, owner: fields[1]})
		}
	}
	return rules
}

func codeOwnerPattern(value string) *regexp.Regexp {
	value = filepath.ToSlash(strings.TrimSpace(value))
	if value == "" || strings.HasPrefix(value, "!") {
		return nil
	}
	anchored := strings.HasPrefix(value, "/") || strings.Contains(strings.TrimPrefix(value, "/"), "/")
	value = strings.TrimPrefix(value, "/")
	if strings.HasSuffix(value, "/") {
		value += "**"
	}
	var expression strings.Builder
	if anchored {
		expression.WriteString("^")
	} else {
		expression.WriteString("(?:^|.*/)")
	}
	for index := 0; index < len(value); {
		if strings.HasPrefix(value[index:], "**/") {
			expression.WriteString("(?:.*/)?")
			index += 3
		} else if strings.HasPrefix(value[index:], "**") {
			expression.WriteString(".*")
			index += 2
		} else if value[index] == '*' {
			expression.WriteString("[^/]*")
			index++
		} else if value[index] == '?' {
			expression.WriteString("[^/]")
			index++
		} else {
			expression.WriteString(regexp.QuoteMeta(string(value[index])))
			index++
		}
	}
	expression.WriteString("$")
	pattern, err := regexp.Compile(expression.String())
	if err != nil {
		return nil
	}
	return pattern
}

func ownerFor(rules []codeOwnerRule, path string) string {
	path = strings.TrimPrefix(filepath.ToSlash(path), "./")
	owner := ""
	for _, rule := range rules {
		if rule.pattern.MatchString(path) {
			owner = rule.owner
		}
	}
	return owner
}
