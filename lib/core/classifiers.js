function domainFromFile(f) {
  const rules = [
    [/^\.github\/workflows\//, "Workflows"],
    [/^\.github\//, "Repository Metadata"],
    [/^README\.md$/, "Documentation"],
  ];
  for (const [re, name] of rules) if (re.test(f)) return name;
  return "Primary Codebase";
}

function isTestFile(f) {
  return /(^test\/|\/test\/|_test\.)/.test(f);
}

function isPublicSurface(f) {
  return /(^api\/|^proto\/|^schema\/|^public\/|^include\/|routes\/|openapi|swagger)/i.test(f);
}

function isRisky(f) {
  return /(auth|billing|payments?|migrations?|infra|terraform|k8s|docker|lock|schema|proto)/i.test(
    f,
  );
}

module.exports = {
  domainFromFile,
  isTestFile,
  isPublicSurface,
  isRisky,
};
