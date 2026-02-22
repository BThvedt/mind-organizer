<?php

namespace Drupal\valet\Plugin;

use Drupal\Component\Plugin\PluginBase;
use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Cache\RefinableCacheableDependencyTrait;
use Drupal\Core\Form\FormStateInterface;

/**
 * Base class for Valet Resource plugins.
 */
abstract class ValetResourceBase extends PluginBase implements ValetResourceInterface {
  use RefinableCacheableDependencyTrait;

  /**
   * Implem \Drupal\exo\Configurable::baseConfigurationDefaults()
   */
  protected function baseConfigurationDefaults() {
    return [];
  }

  /**
   * Implements \Drupal\exo\Configurable::defaultConfiguration()
   */
  public function defaultConfiguration() {
    return [];
  }

  /**
   * Implements \Drupal\exo\Configurable::getDefaultConfiguration()
   */
  public function getDefaultConfiguration() {
    return NestedArray::mergeDeep(
      $this->baseConfigurationDefaults(),
      $this->defaultConfiguration()
    );
  }

  /**
   * Implements \Drupal\exo\Configurable::getConfiguration()
   */
  public function &getConfiguration() {
    return $this->configuration;
  }

  /**
   * Implements \Drupal\exo\Configurable::getValue()
   */
  public function &getConfigurationValue($key, $default = NULL) {
    $exists = NULL;
    $value = &NestedArray::getValue($this->getConfiguration(), (array) $key, $exists);
    if (!$exists) {
      $value = $default;
    }
    return $value;
  }

  /**
   * Implements \Drupal\exo\Configurable::setConfiguration()
   */
  public function setConfiguration(array $values) {
    $existing_values = &$this->getConfiguration();
    $existing_values = NestedArray::mergeDeep(
      $this->getDefaultConfiguration(),
      $values
    );
    return $this;
  }

  /**
   * Implements \Drupal\exo\Configurable::setValue()
   */
  public function setConfigurationValue($key, $value) {
    NestedArray::setValue($this->getConfiguration(), (array) $key, $value, TRUE);
    return $this;
  }

  /**
   * Implements \Drupal\exo\Configurable::unsetValue()
   */
  public function unsetConfigurationValue($key) {
    NestedArray::unsetValue($this->getConfiguration(), (array) $key);
    return $this;
  }

  /**
   * Implements \Drupal\exo\Configurable::hasValue()
   */
  public function hasConfigurationValue($key) {
    $exists = NULL;
    $value = NestedArray::getValue($this->getConfiguration(), (array) $key, $exists);
    return $exists && isset($value);
  }

  /**
   * Implements \Drupal\exo\Configurable::isValueEmpty()
   */
  public function isConfigurationValueEmpty($key) {
    $exists = NULL;
    $value = NestedArray::getValue($this->getConfiguration(), (array) $key, $exists);
    return !$exists || empty($value);
  }

  /**
   * {@inheritdoc}
   */
  public function getResults() {
    return $this->prepareResults();
  }

  /**
   * Build out all results.
   *
   * @return \Drupal\valet\Plugin\ValetItem[]
   *   An array of items.
   */
  protected function prepareResults() {
    return [];
  }

  /**
   * {@inheritdoc}
   *
   * Creates a generic configuration form for all configuration types.
   * Individual configuration plugins can add elements to this form by
   * overriding ConfigurableFormTrait::configurationForm(). Most configuration
   * plugins should not override this method unless they need to alter the
   * generic form elements.
   *
   * @see \Drupal\exo\Plugin\ConfigurableFormTrait::configurationForm()
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form += $this->configurationForm($form, $form_state);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function configurationForm(array $form, FormStateInterface $form_state) {
    return [];
  }

  /**
   * {@inheritdoc}
   *
   * Most configuration plugins should not override this method. To add
   * validation for a specific configuration type, override
   * ConfigurableFormTrait::configurationValidate().
   *
   * @see \Drupal\exo\Plugin\ConfigurableFormTrait::configurationValidate()
   */
  public function validateConfigurationForm(array &$form, FormStateInterface $form_state) {
    $this->configurationValidate($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function configurationValidate(array &$form, FormStateInterface $form_state) {
  }

  /**
   * {@inheritdoc}
   *
   * Most configuration plugins should not override this method. To add
   * submission handling for a specific configuration type, override
   * ConfigurableFormTrait::configurationSubmit().
   *
   * @see \Drupal\exo\Plugin\ConfigurableFormTrait::configurationSubmit()
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state) {
    $this->configurationSubmit($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function configurationSubmit(array &$form, FormStateInterface $form_state) {
  }

  /**
   * {@inheritdoc}
   */
  protected function getIcon($string) {
    if (function_exists('exo_icon')) {
      if ($icon = exo_icon($string)->match([
        'valet',
        'admin',
        'local_task',
      ])->getIcon()) {
        /** @var \Drupal\exo_icon\ExoIcon $icon */
        return $icon->getSelector();
      }
    }
    elseif (function_exists('neo_icon')) {
      $neoIcon = neo_icon($string, NULL, NULL, [
        'valet',
        'admin',
      ]);
      if ($icon = $neoIcon->getIcon()) {
        return $icon->getSelector();
      }
    }
    return '';
  }

}
